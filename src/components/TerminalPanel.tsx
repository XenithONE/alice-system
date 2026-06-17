import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { type FragmentId, type World } from "../data/worlds";
import type { ProgressState } from "../lib/storage";

interface TerminalPanelProps {
  open: boolean;
  progress: ProgressState;
  worlds: World[];
  onClose: () => void;
  onCollect: (fragment: FragmentId) => void;
  onRevealHidden: () => void;
  onUnlockTrue: () => void;
  onMissions: () => void;
  onStartTrial: () => void;
  onAdvanceLoop: () => void;
}

const START_LINES = [
  "AlicE sYsTeM // terminal access granted.",
  "type 'help' for commands."
];

export function TerminalPanel({ open, progress, worlds, onClose, onCollect, onRevealHidden, onUnlockTrue, onMissions, onStartTrial, onAdvanceLoop }: TerminalPanelProps) {
  const [lines, setLines] = useState<string[]>(START_LINES);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 40);
    }
  }, [open]);

  if (!open) return null;

  function print(...next: string[]): void {
    setLines((current) => [...current, ...next].slice(-80));
  }

  function runCommand(rawValue: string): void {
    const command = rawValue.trim().toLowerCase();
    setValue("");
    if (!command) return;
    print(`> ${command}`);

    if (command === "help") {
      print(
        "commands: scan / fragments / atlas / reveal / ascend",
        "          missions / run / besttime / loop / version / clear / exit"
      );
      return;
    }
    if (command === "scan") {
      onCollect("terminal");
      print("// derelict console wakes.", "// FRAGMENT: TERMINAL");
      return;
    }
    if (command === "fragments") {
      print(`SIGNAL FRAGMENTS ${progress.fragments.size}/6`, [...progress.fragments].join(" / ") || "none");
      return;
    }
    if (command === "atlas") {
      const completed = worlds.filter((world) => world.kind === "game" && progress.completedWorlds.has(world.id)).map((world) => world.title);
      print(`WORLDS CONQUERED ${completed.length}/7`, completed.join(" / ") || "none");
      return;
    }
    if (command === "reveal") {
      onRevealHidden();
      print("// hidden world surfaces in the void.");
      return;
    }
    if (command === "ascend") {
      if (progress.sevenWorlds.size >= 7 && progress.accord && !progress.trueEnding) {
        onUnlockTrue();
        print("all seven worlds answer.", "THE SEVENTH SIGNAL IS OPEN.");
      } else if (progress.trueEnding) {
        print("you have already ascended.");
      } else {
        print(`ATLAS INCOMPLETE - ${progress.sevenWorlds.size}/7 worlds / accord ${progress.accord ? "OK" : "SEALED"}`);
      }
      return;
    }
    if (command === "clear") {
      setLines([]);
      return;
    }
    if (command === "exit") {
      onClose();
      return;
    }
    if (command === "alice" || command === "who are you") {
      onCollect("voice");
      print("you said my name. that has weight here.", "// FRAGMENT: VOICE");
      return;
    }
    if (command === "missions") {
      onMissions();
      print("// mission log opened.");
      return;
    }
    if (command === "run") {
      onStartTrial();
      print("// ring run engaged. fly through the gates in order.");
      return;
    }
    if (command === "besttime") {
      print(progress.timeTrialBest > 0 ? `BEST RING RUN ${(progress.timeTrialBest / 1000).toFixed(2)}s` : "no ring run recorded yet.");
      return;
    }
    if (command === "loop") {
      if (progress.trueEnding) {
        onAdvanceLoop();
        print("// NEW LOOP. the layout is remixed.", "the signal remembers.");
      } else {
        print("// loop sealed until the seventh signal.");
      }
      return;
    }
    if (command === "version" || command === "about") {
      print(`AlicE sYsTeM // v${__APP_VERSION__}`, "v1.1 — stardust, missions, ring run, NG+ / perf + fixes.");
      return;
    }
    print("unknown command.");
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    runCommand(value);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter") return;
    event.preventDefault();
    runCommand(value);
  }

  return (
    <div className="terminal-layer" role="dialog" aria-modal="true" aria-label="AlicE terminal">
      <div className="terminal-window">
        <div className="terminal-bar">
          <span />
          <span />
          <span />
          <strong>alice@sys // tty0</strong>
          <button type="button" onClick={onClose}>
            CLOSE
          </button>
        </div>
        <div className="terminal-output">
          {lines.map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
        <form className="terminal-input" onSubmit={submit}>
          <b>&gt;</b>
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={keyDown}
            aria-label="Terminal command"
            spellCheck={false}
            autoComplete="off"
          />
        </form>
      </div>
    </div>
  );
}
