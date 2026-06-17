import { WORLDS, routePath } from "../data/worlds";

export function WebglFallback() {
  return (
    <main className="fallback">
      <div className="fallback-inner">
        <p className="signal-mark">WEBGL FALLBACK</p>
        <h1>AlicE sYsTeM</h1>
        <p>この環境では3D宇宙を初期化できません。各惑星へ直接アクセスできます。</p>
        <nav>
          {WORLDS.filter((world) => !world.hidden).map((world) => (
            <a key={world.id} href={routePath(world.url)}>
              <span>{world.title}</span>
              <small>{world.tags.join(" / ")}</small>
            </a>
          ))}
        </nav>
      </div>
    </main>
  );
}
