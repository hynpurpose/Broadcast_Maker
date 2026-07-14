import { useEffect, useState } from "react";
import type { Character, CharacterDraft } from "./types";
import { api } from "./api";
import { CharacterForm } from "./components/CharacterForm";
import { TtsTester } from "./components/TtsTester";
import { EpisodesPanel } from "./components/EpisodesPanel";
import { ChatsPanel } from "./components/ChatsPanel";

type Tab = "characters" | "episodes" | "chats";

export function App() {
  const [tab, setTab] = useState<Tab>("characters");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [editing, setEditing] = useState<Character | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    try {
      setCharacters(await api.listCharacters());
      setLoadError(null);
    } catch (e) {
      setLoadError(String(e instanceof Error ? e.message : e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(draft: CharacterDraft) {
    if (editing) await api.updateCharacter(editing.id, draft);
    else await api.createCharacter(draft);
    setEditing(null);
    refresh();
  }

  async function handleDelete(id: string) {
    await api.deleteCharacter(id);
    if (editing?.id === id) setEditing(null);
    refresh();
  }

  return (
    <div className="app">
      <header>
        <h1>🎙 Broadcast Maker</h1>
        <nav className="tabs">
          <button className={tab === "characters" ? "tab active" : "tab"} onClick={() => setTab("characters")}>
            角色库
          </button>
          <button className={tab === "episodes" ? "tab active" : "tab"} onClick={() => setTab("episodes")}>
            节目
          </button>
          <button className={tab === "chats" ? "tab active" : "tab"} onClick={() => setTab("chats")}>
            对话
          </button>
        </nav>
      </header>

      {loadError && <p className="error banner">后端未连接：{loadError}</p>}

      {tab === "characters" ? (
        <div className="col">
          <div className="layout">
            <section className="col">
              <CharacterForm editing={editing} onSubmit={handleSubmit} onCancel={() => setEditing(null)} />
            </section>

            <section className="col">
              <TtsTester characters={characters} />
            </section>
          </div>

          <div className="card">
            <h2>角色列表（{characters.length}）</h2>
            {characters.length === 0 && <p className="muted">还没有角色，先创建一个。</p>}
            <ul className="char-list">
              {characters.map((c) => (
                <li key={c.id} className={"char-card-container" + (editing?.id === c.id ? " active" : "")}>
                  <div className={"char-card" + (editing?.id === c.id ? " active" : "")}>
                    {/* Card Header Row */}
                    <div className="char-card-header">
                      <div />
                      <span className="char-meta">
                        {c.speed}x
                      </span>
                    </div>

                    {/* Card Body (Avatar + Info) */}
                    <div className="char-card-body">
                      <div className="char-avatar">
                        {c.avatar ? (
                          <img src={c.avatar} alt={c.name} />
                        ) : (
                          <div className="char-avatar-placeholder">{c.name[0]}</div>
                        )}
                      </div>
                      <div className="char-info">
                        <h3 className="char-name">
                          {c.name}
                          <span className="char-name-faction">
                            {c.faction || "自由人"}
                          </span>
                        </h3>
                        <p className="char-subtitle">{c.persona || "暂无性格设定"}</p>
                      </div>
                    </div>

                    {/* Action Buttons Row */}
                    <div className="char-card-actions">
                      <button onClick={() => setEditing(c)}>编辑</button>
                      <button className="danger" onClick={() => handleDelete(c.id)}>删除</button>
                    </div>
                  </div>

                  {/* Bottom Peek Layer */}
                  {c.languageStyle && (
                    <div className="char-card-peek">
                      <span>💬 {c.languageStyle}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : tab === "episodes" ? (
        <EpisodesPanel characters={characters} />
      ) : (
        <ChatsPanel characters={characters} />
      )}
    </div>
  );
}
