import { ACHIEVEMENTS } from "../lib/achievements";
import type { ProgressState } from "../lib/storage";

interface AchievementsPanelProps {
  open: boolean;
  progress: ProgressState;
  onClose: () => void;
}

export function AchievementsPanel({ open, progress, onClose }: AchievementsPanelProps) {
  if (!open) return null;
  const unlocked = ACHIEVEMENTS.filter((a) => progress.achievements.has(a.id)).length;
  return (
    <div className="terminal-layer" role="dialog" aria-modal="true" aria-label="missions and achievements">
      <div className="terminal-window">
        <div className="terminal-bar">
          <span />
          <span />
          <span />
          <strong>
            missions // {unlocked}/{ACHIEVEMENTS.length}
          </strong>
          <button type="button" onClick={onClose}>
            CLOSE
          </button>
        </div>
        <div className="terminal-output">
          {ACHIEVEMENTS.map((achievement) => {
            const got = progress.achievements.has(achievement.id);
            return (
              <p key={achievement.id} style={{ opacity: got ? 1 : 0.5 }}>
                {got ? "◈" : "▢"} {achievement.title} — {got ? achievement.desc : "???"}
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}
