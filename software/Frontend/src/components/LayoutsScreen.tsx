import { useState } from "react";
import type { SavedLayout } from "@mapw/backend/renderer";
import { ArrowRightIcon, BookmarkIcon, CliIcon, GridIcon, InboxIcon, InfoIcon, LayersIcon, PencilIcon, SaveIcon, TrashIcon, XIcon } from "@/components/Icons";
import { BUILTIN_LAYOUTS, deleteSavedLayout, renameSavedLayout, saveCurrentLayout, summarizeLayout } from "@/stores/layouts";
import { useCanvasStore } from "@/stores/canvas";
import { useCliToolsStore } from "@/stores/cliTools";
import { useSettingsStore } from "@/stores/settings";

export interface LayoutsScreenProps { readonly onApply: (layout: SavedLayout) => void; readonly onClose: () => void; }

function LayoutPreview({ layout, variant = "card" }: { layout: SavedLayout; variant?: "card" | "row" }) {
  const nodes = layout.nodes;
  if (nodes.length === 0) return <div className="layouts__preview layouts__preview--empty" />;
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...nodes.map((n) => n.position.x + (n.size?.width ?? 560)));
  const maxY = Math.max(...nodes.map((n) => n.position.y + (n.size?.height ?? 320)));
  const w = maxX - minX || 560;
  const h = maxY - minY || 320;
  const isRow = variant === "row";
  const availW = isRow ? 96 : 320;
  const availH = isRow ? 48 : 76;
  const scale = Math.min(availW / w, availH / h) * 0.96;
  const contentW = w * scale;
  const contentH = h * scale;
  return (
    <div className="layouts__preview" aria-hidden="true">
      <div className="layouts__preview-canvas" style={{ width: contentW, height: contentH }}>
        {nodes.map((n) => {
          const x = (n.position.x - minX) * scale;
          const y = (n.position.y - minY) * scale;
          const pw = (n.size?.width ?? 560) * scale;
          const ph = (n.size?.height ?? 320) * scale;
          return <span key={n.paneId} className="layouts__preview-pane" style={{ left: x, top: y, width: pw, height: ph }} />;
        })}
      </div>
    </div>
  );
}

function MissingBadge({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <span className="layouts__missing-badge">
      <InfoIcon size={11} style={{ flexShrink: 0, color: "#D97706" }} />
      <span style={{ display: "inline-flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        missing:{" "}
        {ids.map((id, i) => (
          <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
            <CliIcon id={id} size={11} />
            {id}
            {i < ids.length - 1 ? ", " : ""}
          </span>
        ))}
      </span>
    </span>
  );
}

export function LayoutsScreen({ onApply, onClose }: LayoutsScreenProps) {
  const savedLayouts = useSettingsStore((s) => s.settings.savedLayouts);
  const cliTools = useCliToolsStore((s) => s.cliTools);
  const canvasNodes = useCanvasStore((s) => s.nodes);
  const [newName, setNewName] = useState("");
  const installedIds = new Set(cliTools.map((c) => c.id));
  const missingFor = (layout: SavedLayout): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of layout.nodes) { const c = n.cliId; if (c != null && !installedIds.has(c) && !seen.has(c)) { seen.add(c); out.push(c); } }
    return out;
  };
  const onSaveSubmit = async () => {
    const name = newName.trim();
    if (!name) return;
    await saveCurrentLayout(name);
    setNewName("");
  };
  const countLabel = `${canvasNodes.length} terminal${canvasNodes.length === 1 ? "" : "s"}`;
  return (
    <div className="layouts" data-testid="layouts-screen">
      <button type="button" className="layouts__close" onClick={onClose} aria-label="Close Layouts panel" data-testid="layouts-close"><XIcon size={14} /></button>
      <div className="layouts__header">
        <div className="layouts__hero" aria-hidden="true">
          <span className="layouts__hero-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <rect x="2" y="2" width="7" height="7" rx="1.4" stroke="#1C1917" strokeWidth="1.3" />
              <rect x="11" y="2" width="7" height="7" rx="1.4" stroke="#1C1917" strokeWidth="1.3" />
              <rect x="2" y="11" width="7" height="7" rx="1.4" stroke="#1C1917" strokeWidth="1.3" />
              <rect x="11" y="11" width="7" height="7" rx="1.4" stroke="#1C1917" strokeWidth="1.3" />
            </svg>
          </span>
        </div>
        <h1 className="layouts__headline">Layouts</h1>
      </div>

      <section className="layouts__section">
        <div className="layouts__section-head">
          <h2 className="layouts__heading"><GridIcon size={12} style={{ marginRight: 7, color: "#57534E" }} />Templates</h2>
          <span className="layouts__count">{BUILTIN_LAYOUTS.length} available</span>
        </div>
        <div className="layouts__grid">
          {BUILTIN_LAYOUTS.map((layout) => {
            const missing = missingFor(layout);
            return (
              <article key={layout.id} className="layouts__card layouts__card--template" data-testid={`layouts-builtin-${layout.id}`}>
                <LayoutPreview layout={layout} />
                <div className="layouts__card-body">
                  <h3 className="layouts__card-name"><GridIcon size={12} style={{ marginRight: 6, color: "#57534E" }} />{layout.name}</h3>
                  <p className="layouts__summary">{summarizeLayout(layout)}</p>
                  <MissingBadge ids={missing} />
                </div>
                <button type="button" className="layouts__apply" onClick={() => onApply(layout)} data-testid={`layouts-apply-builtin-${layout.id}`}>Use template <ArrowRightIcon size={12} style={{ marginLeft: 6, color: "#FFF" }} /></button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="layouts__section">
        <div className="layouts__section-head">
          <h2 className="layouts__heading"><BookmarkIcon size={12} style={{ marginRight: 7, color: "#7C3AED" }} />Your layouts</h2>
          <span className="layouts__count">{savedLayouts.length === 0 ? "None yet" : `${savedLayouts.length} saved`}</span>
        </div>
        {savedLayouts.length === 0 ? (
          <div className="layouts__empty">
            <div className="layouts__empty-icon" style={{ background: "#FFF7ED", borderColor: "#FED7AA", color: "#D97706" }}><InboxIcon size={20} /></div>
            <p className="layouts__empty-title">No saved layouts</p>
            <p className="layouts__hint">No saved layouts yet.</p>
          </div>
        ) : (
          <ul className="layouts__list">
            {savedLayouts.map((layout) => (
              <li key={layout.id} className="layouts__row" data-testid={`layouts-saved-${layout.id}`}>
                <div className="layouts__row-preview"><LayoutPreview layout={layout} variant="row" /></div>
                <SavedRow layout={layout} missing={missingFor(layout)} onApply={onApply} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="layouts__section layouts__section--save">
        <div className="layouts__section-head">
          <h2 className="layouts__heading"><SaveIcon size={12} style={{ marginRight: 7, color: "#059669" }} />Save current</h2>
          <span className="layouts__count">{countLabel} on canvas</span>
        </div>
        <div className="layouts__card layouts__card--save" data-testid="layouts-save-form">
          <div className="layouts__save-row">
            <input type="text" className="layouts__input" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onSaveSubmit(); }} data-testid="layouts-save-name" />
            <button type="button" className="layouts__save-btn" disabled={newName.trim() === ""} onClick={() => void onSaveSubmit()} data-testid="layouts-save-btn"><SaveIcon size={13} style={{ marginRight: 6, color: "#FFF" }} />Save</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SavedRow({ layout, missing, onApply }: { layout: SavedLayout; missing: string[]; onApply: (l: SavedLayout) => void }) {
  const [draftName, setDraftName] = useState(layout.name);
  const [renaming, setRenaming] = useState(false);
  const commitRename = async () => {
    const next = draftName.trim();
    if (!next || next === layout.name) { setDraftName(layout.name); setRenaming(false); return; }
    await renameSavedLayout(layout.id, next);
    setRenaming(false);
  };
  return (
    <div className="layouts__row-main">
      <div className="layouts__row-head">
        {renaming ? (
          <input type="text" className="layouts__input layouts__input--inline" value={draftName} onChange={(e) => setDraftName(e.target.value)} onBlur={() => void commitRename()} onKeyDown={(e) => { if (e.key === "Enter") void commitRename(); else if (e.key === "Escape") { setDraftName(layout.name); setRenaming(false); } }} data-testid={`layouts-rename-input-${layout.id}`} autoFocus />
        ) : (
          <button type="button" className="layouts__row-name" onClick={() => { setDraftName(layout.name); setRenaming(true); }} data-testid={`layouts-rename-btn-${layout.id}`} aria-label={`Rename ${layout.name}`}><BookmarkIcon size={11} style={{ marginRight: 6, color: "#7C3AED" }} />{layout.name}</button>
        )}
          <span className="layouts__summary layouts__summary--inline" data-testid={`layouts-saved-summary-${layout.id}`}><GridIcon size={10} style={{ marginRight: 5, color: "#57534E" }} />{summarizeLayout(layout)}</span>
        <MissingBadge ids={missing} />
      </div>
      <div className="layouts__row-actions">
        <button type="button" className="layouts__chip layouts__chip--primary" onClick={() => onApply(layout)} data-testid={`layouts-apply-saved-${layout.id}`}>Apply <ArrowRightIcon size={11} style={{ marginLeft: 6, color: "#FFF" }} /></button>
        {!renaming && <button type="button" className="layouts__chip" onClick={() => { setDraftName(layout.name); setRenaming(true); }} data-testid={`layouts-rename-go-${layout.id}`}><PencilIcon size={11} style={{ marginRight: 5, color: "#2563EB" }} />Rename</button>}
        <button type="button" className="layouts__chip layouts__chip--danger" onClick={() => void deleteSavedLayout(layout.id)} data-testid={`layouts-delete-${layout.id}`}><TrashIcon size={11} style={{ marginRight: 5, color: "#DC2626" }} />Delete</button>
      </div>
    </div>
  );
}