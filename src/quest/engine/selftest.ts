import { buildContent, validateContent } from "../content";
import { chooseIntent } from "./bot";
import { applyIntent, createGame } from "./engine";
import { mulberry32 } from "./rng";
import type { ClassId, GameState, Intent } from "./types";

declare const process: { exitCode?: number };

const CLASSES: ClassId[] = ["knight", "rogue", "mage", "cleric"];
const SEEDS = 20;
const INTENT_CAP = 5_000;

type Result = {
  seed: number;
  pass: boolean;
  winner: number | null;
  rounds: number;
  deaths: number;
  relics: number;
  playersWithTwoRelics: number;
  totalLevels: number;
  playerCount: number;
  finalGuardianWin: boolean;
  finalSeen: boolean;
  lowestFinalHp: number | null;
  incidents: number;
  reason?: string;
};

function dump(state: GameState): string {
  return JSON.stringify({
    round: state.round,
    current: state.current,
    phase: state.phase,
    combat: state.combat?.monsterId ?? null,
    players: state.players.map((p) => ({
      seat: p.seat, hp: p.hp, level: p.level, xp: p.xp, gold: p.gold,
      relics: p.relics, node: p.node, deaths: p.deaths, choice: p.pendingChoice?.t ?? null,
    })),
  });
}

function runSeed(seed: number): Result {
  const content = buildContent();
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const lobby = CLASSES.map((_, seat) => ({
    name: `BOT${seat}`,
    cls: CLASSES[(seat + seed - 1) % CLASSES.length]!,
    bot: true,
  }));
  const state = createGame(content, seed, lobby);
  let incidents = 0;
  let applied = 0;
  let reason: string | undefined;
  let finalGuardianWin = false;
  let finalSeen = false;
  let lowestFinalHp: number | null = null;

  while (state.phase === "playing") {
    if (applied >= INTENT_CAP) {
      reason = `intent cap exceeded: ${dump(state)}`;
      break;
    }
    const seat = state.current;
    if (state.combat?.final) {
      finalSeen = true;
      lowestFinalHp = Math.min(lowestFinalHp ?? state.combat.monsterHp, state.combat.monsterHp);
    }
    let intent: Intent;
    try {
      intent = chooseIntent(content, state, seat, rng);
    } catch (error) {
      reason = `bot exception: ${error instanceof Error ? error.stack ?? error.message : String(error)} ${dump(state)}`;
      break;
    }
    const wasFinalCombat = state.combat?.final === true;
    const result = applyIntent(content, state, seat, intent, rng);
    if (!result.ok) {
      incidents += 1;
      console.error(`INVALID seed=${seed} seat=${seat} intent=${JSON.stringify(intent)} error=${result.error}`);
      const fallback: Intent = { k: "endTurn" };
      const fallbackResult = applyIntent(content, state, seat, fallback, rng);
      if (fallbackResult.ok) applied += 1;
      if (incidents >= 3) {
        reason = `3 invalid incidents: ${dump(state)}`;
        break;
      }
      if (!fallbackResult.ok) {
        reason = `fallback endTurn failed: ${fallbackResult.error} ${dump(state)}`;
        break;
      }
      continue;
    }
    applied += 1;
    if (wasFinalCombat && state.phase !== "playing") finalGuardianWin = true;
  }

  const pass = !reason && state.phase === "finished" && state.winner !== null && state.round <= state.roundLimit;
  if (!pass && !reason) reason = `invalid finish: ${dump(state)}`;
  return {
    seed, pass, winner: state.winner, rounds: Math.min(state.round, state.roundLimit),
    deaths: state.players.reduce((sum, player) => sum + player.deaths, 0),
    relics: state.players.reduce((sum, player) => sum + player.relics.length, 0),
    playersWithTwoRelics: state.players.filter((player) => player.relics.length >= 2).length,
    totalLevels: state.players.reduce((sum, player) => sum + player.level, 0),
    playerCount: state.players.length,
    finalGuardianWin,
    finalSeen,
    lowestFinalHp,
    incidents, reason,
  };
}

const contentProblems = validateContent(buildContent());
if (contentProblems.length) {
  console.error("CONTENT INVALID");
  contentProblems.forEach((problem) => console.error(`- ${problem}`));
  process.exitCode = 1;
} else {
  const results = Array.from({ length: SEEDS }, (_, index) => runSeed(index + 1));
  const distribution = [0, 0, 0, 0];
  for (const result of results) {
    if (result.winner !== null) distribution[result.winner] += 1;
    console.log(
      `seed ${String(result.seed).padStart(2, "0")}: ${result.pass ? "PASS" : "FAIL"} ` +
      `winner=${result.winner ?? "-"} rounds=${result.rounds} deaths=${result.deaths} ` +
      `relics=${result.relics} levelAvg=${(result.totalLevels / result.playerCount).toFixed(2)} ` +
      `final=${result.finalGuardianWin ? "yes" : "no"} ` +
      `finalSeen=${result.finalSeen ? "yes" : "no"} finalMinHp=${result.lowestFinalHp ?? "-"} ` +
      `invalid=${result.incidents}` +
      (result.reason ? ` reason=${result.reason}` : ""),
    );
  }
  const average = (field: "rounds" | "deaths" | "relics") =>
    results.reduce((sum, result) => sum + result[field], 0) / results.length;
  const failures = results.filter((result) => !result.pass).length;
  const totalRelics = results.reduce((sum, result) => sum + result.relics, 0);
  const seedsWithTwoRelics = results.filter((result) => result.playersWithTwoRelics > 0).length;
  const finalGuardianWins = results.filter((result) => result.finalGuardianWin).length;
  const totalLevels = results.reduce((sum, result) => sum + result.totalLevels, 0);
  const totalPlayers = results.reduce((sum, result) => sum + result.playerCount, 0);
  const averageLevel = totalLevels / totalPlayers;
  const criteria = [
    { label: `all ${SEEDS} seeds finish cleanly`, actual: `${SEEDS - failures}/${SEEDS}`, pass: failures === 0 },
    { label: "total relics > 20", actual: String(totalRelics), pass: totalRelics > 20 },
    { label: "seeds with a 2+ relic player >= 5", actual: String(seedsWithTwoRelics), pass: seedsWithTwoRelics >= 5 },
    { label: "final guardian wins >= 3", actual: String(finalGuardianWins), pass: finalGuardianWins >= 3 },
    { label: "average player level >= 2.3", actual: averageLevel.toFixed(3), pass: averageLevel >= 2.3 },
  ];
  console.log(`winner distribution: seat0=${distribution[0]} seat1=${distribution[1]} seat2=${distribution[2]} seat3=${distribution[3]}`);
  console.log(`average rounds: ${average("rounds").toFixed(2)}`);
  console.log(`average deaths: ${average("deaths").toFixed(2)}`);
  console.log(`average relic totals: ${average("relics").toFixed(2)}`);
  console.log("aggregate criteria:");
  criteria.forEach((criterion) =>
    console.log(`- ${criterion.pass ? "PASS" : "FAIL"} ${criterion.label}: actual=${criterion.actual}`));
  const gatePasses = criteria.every((criterion) => criterion.pass);
  console.log(gatePasses ? "SELFTEST PASS" : "SELFTEST FAIL");
  if (!gatePasses) process.exitCode = 1;
}
