// LayoutsScreen — the workspace overlay panel the user opens from the
// titlebar's Layouts button. PER CLUSTER 1, Workspace renders this surface
// ON TOP of the active phase fragment (welcome/returning/ready) — NOT as a
// sibling-ternary swap that would unmount the prior fragment. The phase
// content — when ready, the TerminalCanvas with all mounted <TerminalPane>s
// + their live PTYs — stays mounted underneath; the panel covers full-bleed
// via `.layouts { position: absolute; inset: 0; z-index: 5; }` (styles.css).
// The prior swap-design unmounted the TerminalCanvas the moment the panel
// opened — silently ptyKill-ing every pane out from under a layout picker;
// the overlay fixes that. Mirrors the .welcome / .returning surface idiom —
// centered column over the workspace sheet, value-step white cards, primary
// + ghost button recipes — so it reads as the same surface vocabulary as the
// boot screens, NOT a floating drawer (the codebase has zero modal/drawer
// precedent, so the overlay-panel pattern — rendered alongside the canvas,
// absolutely-positioned to cover it — is the idiom for these full-screen
// overlays).
//
// Three sections:
//   1. Built-in layouts — 2-col grid of cards. Each card shows the layout's
//      name, a mono pane/cli summary (summarizeLayout), an optional
//      `[missing: claude]` badge (when a referenced CLI isn't installed), and
//      an Apply chip. Apply → onApply(layout) (Workspace passes the
//      applyLayout + setPhase("ready") + closeLayouts inlined callback).
//   2. My saved layouts — list rows. Each row: an inline-editable name
//      (button → input on rename; Enter/Blur commits; Esc reverts), a
//      summary chip, optional missing badge, and Apply / Rename / Delete
//      chips. Built-ins are immutable constants — never appear in this list.
//      Delete is immediate (no confirm — re-saves are easy via section 3).
//   3. Save current canvas as a layout — a single .layouts__card with a
//      text input for the name + a primary Save button disabled until the
//      name is non-empty. Save reads useCanvasStore.getState().nodes +
//      writes via saveCurrentLayout (the read-modify-write helper in
//      @/stores/layouts). The new row appears in section 2 once the settings
//      store update resolves.

import { useState } from "react";
import type { SavedLayout } from "@bridgespace/backend/renderer";
import { ArrowRightIcon, XIcon } from "@/components/Icons";
import {
  BUILTIN_LAYOUTS,
  deleteSavedLayout,
  renameSavedLayout,
  saveCurrentLayout,
  summarizeLayout,
} from "@/stores/layouts";
import { useCanvasStore } from "@/stores/canvas";
import { useCliToolsStore } from "@/stores/cliTools";
import { useSettingsStore } from "@/stores/settings";

export interface LayoutsScreenProps {
  /** Workspace-wired handler invoked on Apply (built-in or saved). Replaces
   *  the canvas via applyLayout + jumps Workspace's phase to "ready" (so the
   *  newly-hydrated canvas mounts even if the panel was opened from
   *  welcome/returning) + closes the panel. The callback closure lives in
   *  Workspace.tsx. */
  readonly onApply: (layout: SavedLayout) => void;
  /** Close the panel without applying — Workspace's onCloseLayouts. */
  readonly onClose: () => void;
}

export function LayoutsScreen({ onApply, onClose }: LayoutsScreenProps) {
  const savedLayouts = useSettingsStore((s) => s.settings.savedLayouts);
  const cliTools = useCliToolsStore((s) => s.cliTools);
  const canvasNodes = useCanvasStore((s) => s.nodes);
  const [newName, setNewName] = useState("");

  // Installed CLI ids in O(1) for missing-badge rendering. Built-ins
  // reference CLIs by stable curated id; if the layout's `claude` id isn't
  // in the installed set (the user is missing that CLI on PATH), the card
  // shows the missing badge + apply still proceeds (TerminalPane writes a
  // yellow warning in that pane + keeps the chip strip live for manual launch).
  const installedIds = new Set(cliTools.map((c) => c.id));

  // Missing referenced CLI ids for a given layout (insertion order, dedup'd)
  // — drives the per-card `[missing: ...]` badge. Empty list = no badge.
  const missingFor = (layout: SavedLayout): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of layout.nodes) {
      const c = n.cliId;
      if (c != null && !installedIds.has(c) && !seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
    return out;
  };

  const onSaveSubmit = async () => {
    const name = newName.trim();
    if (name === "") return;
    await saveCurrentLayout(name);
    setNewName("");
  };

  const paneSuffix = canvasNodes.length === 1 ? "" : "s";

  return (
    <div className="layouts" data-testid="layouts-screen">
      <button
        type="button"
        className="layouts__close"
        onClick={onClose}
        aria-label="Close Layouts panel"
        data-testid="layouts-close"
      >
        <XIcon />
      </button>
      <h1 className="layouts__headline">Layouts</h1>
      <p className="layouts__sub">
        Pick the built-in preset, save the current canvas as a layout, or apply
        a layout you saved earlier. Saved layouts are global — available in
        every workspace.
      </p>

      <section className="layouts__section">
        <h2 className="layouts__heading">Built-in presets</h2>
        <div className="layouts__grid">
          {BUILTIN_LAYOUTS.map((layout) => {
            const missing = missingFor(layout);
            return (
              <article
                key={layout.id}
                className="layouts__card"
                data-testid={`layouts-builtin-${layout.id}`}
              >
                <h3 className="layouts__card-name">{layout.name}</h3>
                <p className="layouts__summary">{summarizeLayout(layout)}</p>
                {missing.length > 0 && (
                  <span className="layouts__missing-badge">
                    missing: {missing.join(", ")}
                  </span>
                )}
                <button
                  type="button"
                  className="layouts__apply"
                  onClick={() => onApply(layout)}
                  data-testid={`layouts-apply-builtin-${layout.id}`}
                >
                  Apply <ArrowRightIcon style={{ marginLeft: 4 }} />
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="layouts__section">
        <h2 className="layouts__heading">My saved layouts</h2>
        {savedLayouts.length === 0 ? (
          <p className="layouts__hint">
            No saved layouts yet. Use the form below to save the current
            canvas.
          </p>
        ) : (
          <ul className="layouts__list">
            {savedLayouts.map((layout) => (
              <li
                key={layout.id}
                className="layouts__row"
                data-testid={`layouts-saved-${layout.id}`}
              >
                <SavedRow
                  layout={layout}
                  missing={missingFor(layout)}
                  onApply={onApply}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="layouts__section">
        <h2 className="layouts__heading">Save current canvas</h2>
        <div
          className="layouts__card layouts__card--full"
          data-testid="layouts-save-form"
        >
          <p className="layouts__hint">
            Snapshots the {canvasNodes.length} pane{paneSuffix} currently in
            the canvas — including CLI bindings — as a named layout you can
            apply in any workspace.
          </p>
          <div className="layouts__save-row">
            <input
              type="text"
              className="layouts__input"
              placeholder="Layout name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void onSaveSubmit();
                }
              }}
              data-testid="layouts-save-name"
            />
            <button
              type="button"
              className="layouts__save-btn"
              disabled={newName.trim() === ""}
              onClick={() => void onSaveSubmit()}
              data-testid="layouts-save-btn"
            >
              Save
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

interface SavedRowProps {
  readonly layout: SavedLayout;
  readonly missing: string[];
  readonly onApply: (layout: SavedLayout) => void;
}

// One row in the saved-layouts list. The name is a button that flips into an
// <input> when clicked (inline-editable); Enter or Blur commits the rename,
// Esc reverts. Apply / Delete are one-shot affordances — Delete is immediate
// (re-saves are easy via the Save-current-canvas form below; a confirm modal
// is out of scope for the codebase's idiom).
function SavedRow({ layout, missing, onApply }: SavedRowProps) {
  const [draftName, setDraftName] = useState(layout.name);
  const [renaming, setRenaming] = useState(false);

  const commitRename = async () => {
    const next = draftName.trim();
    if (next === "" || next === layout.name) {
      setDraftName(layout.name);
      setRenaming(false);
      return;
    }
    await renameSavedLayout(layout.id, next);
    setRenaming(false);
  };

  return (
    <>
      {renaming ? (
        <input
          type="text"
          className="layouts__input layouts__input--inline"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void commitRename();
            } else if (e.key === "Escape") {
              setDraftName(layout.name);
              setRenaming(false);
            }
          }}
          data-testid={`layouts-rename-input-${layout.id}`}
          autoFocus
        />
      ) : (
        <button
          type="button"
          className="layouts__row-name"
          onClick={() => {
            setDraftName(layout.name);
            setRenaming(true);
          }}
          data-testid={`layouts-rename-btn-${layout.id}`}
          aria-label={`Rename ${layout.name}`}
        >
          {layout.name}
        </button>
      )}
      <span
        className="layouts__summary layouts__summary--inline"
        data-testid={`layouts-saved-summary-${layout.id}`}
      >
        {summarizeLayout(layout)}
      </span>
      {missing.length > 0 && (
        <span className="layouts__missing-badge">
          missing: {missing.join(", ")}
        </span>
      )}
      <div className="layouts__row-actions">
        <button
          type="button"
          className="layouts__chip"
          onClick={() => onApply(layout)}
          data-testid={`layouts-apply-saved-${layout.id}`}
        >
          Apply
        </button>
        {!renaming && (
          <button
            type="button"
            className="layouts__chip"
            onClick={() => {
              setDraftName(layout.name);
              setRenaming(true);
            }}
            data-testid={`layouts-rename-go-${layout.id}`}
          >
            Rename
          </button>
        )}
        <button
          type="button"
          className="layouts__chip layouts__chip--danger"
          onClick={() => void deleteSavedLayout(layout.id)}
          data-testid={`layouts-delete-${layout.id}`}
        >
          Delete
        </button>
      </div>
    </>
  );
}
