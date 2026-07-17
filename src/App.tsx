import { useEffect, useState } from "react";
import type { Character, CharacterDraft } from "./types";
import { api } from "./api";
import { CharacterForm } from "./components/CharacterForm";
import { TtsTester } from "./components/TtsTester";
import { RandomCharacter } from "./components/RandomCharacter";
import { EpisodesPanel } from "./components/EpisodesPanel";
import { ChatsPanel } from "./components/ChatsPanel";
import { ReadingsPanel } from "./components/ReadingsPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";

type Tab = "characters" | "episodes" | "chats" | "readings";

export function App() {
  const [tab, setTab] = useState<Tab>("characters");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [editing, setEditing] = useState<Character | null>(null);
  const [formSeed, setFormSeed] = useState<{ key: number; draft: CharacterDraft } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);

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
    setFormSeed(null);
    refresh();
  }

  function requestDeleteCharacter(id: string) {
    const c = characters.find((x) => x.id === id);
    setPendingDelete({ id, name: c?.name?.trim() || "该角色" });
  }

  async function confirmDeleteCharacter() {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setPendingDelete(null);
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
          <button className={tab === "readings" ? "tab active" : "tab"} onClick={() => setTab("readings")}>
            精读
          </button>
        </nav>
      </header>

      {loadError && <p className="error banner">后端未连接：{loadError}</p>}

      {tab === "characters" ? (
        <div className="col">
          <div className="layout characters-workspace">
            <section className="col">
              <CharacterForm
                editing={editing}
                seed={formSeed}
                onSubmit={handleSubmit}
                onCancel={() => {
                  setEditing(null);
                  setFormSeed(null);
                }}
                onClear={() => setFormSeed(null)}
              />
            </section>

            <section className="col">
              <TtsTester characters={characters} />
              <RandomCharacter
                onGenerated={(draft) => {
                  setEditing(null);
                  setFormSeed({ key: Date.now(), draft });
                }}
              />
            </section>
          </div>

          <div className="card">
            <h2>角色列表（{characters.length}）</h2>
            {characters.length === 0 && <p className="muted">还没有角色，先创建一个。</p>}
            <ul className="char-list">
              {characters.map((c) => (
                <li key={c.id} className={"char-card-container" + (editing?.id === c.id ? " active" : "")}>
                  <div className={"char-card" + (editing?.id === c.id ? " active" : "")}>
                    <div className="char-card-header">
                      <div />
                      <span className="char-meta">{c.speed}x</span>
                    </div>

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
                          <span className="char-name-faction">{c.faction || "自由人"}</span>
                        </h3>
                        <p className="char-subtitle">{c.persona || "暂无性格设定"}</p>
                      </div>
                    </div>

                    <div className="char-card-actions">
                      <button
                        onClick={() => {
                          setFormSeed(null);
                          setEditing(c);
                        }}
                      >
                        编辑
                      </button>
                      <button className="danger" onClick={() => requestDeleteCharacter(c.id)}>
                        删除
                      </button>
                    </div>
                  </div>

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
      ) : tab === "chats" ? (
        <ChatsPanel characters={characters} />
      ) : (
        <ReadingsPanel characters={characters} />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="删除角色"
          message={`确定删除角色「${pendingDelete.name}」？此操作不可撤销。`}
          onConfirm={confirmDeleteCharacter}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
