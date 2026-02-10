"use strict";
// ─────────────────────────────────────────────
// Text Finder — Figma Plugin (Sandbox Code)
// ─────────────────────────────────────────────
// ── Recursive TEXT node finder (skips invisible) ──
function findVisibleTextNodes(node) {
    if (!node.visible)
        return [];
    if (node.type === "TEXT")
        return [node];
    if ("children" in node) {
        return node.children.flatMap(findVisibleTextNodes);
    }
    return [];
}
// ── Style name resolver ─────────────────────
function resolveStyleName(textStyleId) {
    if (textStyleId === figma.mixed) {
        return { name: "🟡 Mixed", unlinked: false };
    }
    if (!textStyleId || textStyleId === "") {
        return { name: "🔴 Unlinked", unlinked: true };
    }
    try {
        const s = figma.getStyleById(textStyleId);
        if (s && s.name) {
            return { name: s.name, unlinked: false };
        }
    }
    catch (_) { }
    return { name: "🔴 Unlinked", unlinked: true };
}
// ── Format helpers ──────────────────────────
function formatFontSize(fontSize) {
    if (fontSize === figma.mixed)
        return "Mixed";
    return `${Math.round(fontSize)}`;
}
function formatFontFamily(fontName) {
    if (fontName === figma.mixed)
        return "Mixed";
    return `${fontName.family} ${fontName.style}`;
}
function formatLetterSpacing(ls) {
    if (ls === figma.mixed)
        return "Mixed";
    if (ls.unit === "PERCENT")
        return `${parseFloat(ls.value.toFixed(2))}%`;
    return `${parseFloat(ls.value.toFixed(2))}px`;
}
function formatLineHeight(lh) {
    if (lh === figma.mixed)
        return "Mixed";
    if (lh.unit === "AUTO")
        return "Auto";
    if (lh.unit === "PERCENT")
        return `${parseFloat(lh.value.toFixed(2))}%`;
    return `${parseFloat(lh.value.toFixed(2))}px`;
}
// ── Extract row data ────────────────────────
function extractData(node) {
    const styleInfo = resolveStyleName(node.textStyleId);
    return {
        nodeId: node.id,
        textContent: node.characters,
        styleName: styleInfo.name,
        fontSize: formatFontSize(node.fontSize),
        fontFamily: formatFontFamily(node.fontName),
        letterSpacing: formatLetterSpacing(node.letterSpacing),
        lineHeight: formatLineHeight(node.lineHeight),
        isUnlinked: styleInfo.unlinked,
        isModified: false,
    };
}
// ── Main ────────────────────────────────────
figma.showUI(__html__, { width: 800, height: 600, themeColors: true });
// ── State ───────────────────────────────────
let lastActiveFrameId = null;
let isNavigating = false;
const originalDataMap = new Map();
// ── Serialize row for comparison ────────────
function serializeRow(r) {
    return JSON.stringify({ t: r.textContent, s: r.styleName, fs: r.fontSize, ff: r.fontFamily, ls: r.letterSpacing, lh: r.lineHeight });
}
// ── Take snapshot of initial state ──────────
function takeSnapshot(rows) {
    originalDataMap.clear();
    for (const r of rows) {
        originalDataMap.set(r.nodeId, serializeRow(r));
    }
}
// ── Mark modified rows by comparing to snapshot ──
function markModified(rows) {
    return rows.map(r => (Object.assign(Object.assign({}, r), { isModified: originalDataMap.has(r.nodeId) && originalDataMap.get(r.nodeId) !== serializeRow(r) })));
}
const CONTAINER_TYPES = new Set(["FRAME", "SECTION", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP"]);
// ── Check if a node is a descendant of a specific frame ──
function isChildOf(node, ancestorId) {
    let current = node.parent;
    while (current) {
        if (current.id === ancestorId)
            return true;
        current = current.parent;
    }
    return false;
}
// ── Scan a specific frame by ID & send to UI ──
function scanFrame(frameId, isNewContext = false) {
    const frameNode = figma.getNodeById(frameId);
    if (!frameNode || !("children" in frameNode)) {
        figma.ui.postMessage({ type: "no-text" });
        return;
    }
    const textNodes = frameNode.children.flatMap(findVisibleTextNodes);
    if (textNodes.length === 0) {
        figma.ui.postMessage({ type: "no-text" });
        return;
    }
    let rows = textNodes.map(extractData);
    if (isNewContext) {
        // New frame selected → take snapshot, no modifications yet
        rows = rows.map(r => (Object.assign(Object.assign({}, r), { isModified: false })));
        takeSnapshot(rows);
    }
    else {
        // Re-scan → compare against snapshot
        rows = markModified(rows);
    }
    figma.ui.postMessage({ type: "result", data: rows });
}
// ── Initial scan from startup selection ─────
function initFromSelection() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        figma.ui.postMessage({ type: "empty" });
        return;
    }
    // Find the first container in selection
    const container = selection.find(n => CONTAINER_TYPES.has(n.type));
    if (container) {
        lastActiveFrameId = container.id;
        scanFrame(container.id, true);
    }
    else {
        figma.ui.postMessage({ type: "empty" });
    }
}
initFromSelection();
// ── Selection change handler ────────────────
figma.on("selectionchange", () => {
    // Skip if triggered by UI row click (navigation)
    if (isNavigating) {
        isNavigating = false;
        return;
    }
    const selection = figma.currentPage.selection;
    // Case A: A container is directly selected → switch context
    if (selection.length > 0) {
        const container = selection.find(n => CONTAINER_TYPES.has(n.type));
        if (container) {
            lastActiveFrameId = container.id;
            scanFrame(container.id, true);
            return;
        }
    }
    // Case B: Selected node is a child of the active frame → re-scan (reflect edits)
    if (lastActiveFrameId && selection.length > 0) {
        const isInsideActiveFrame = selection.some(n => isChildOf(n, lastActiveFrameId));
        if (isInsideActiveFrame) {
            scanFrame(lastActiveFrameId);
            return;
        }
    }
    // Case C: Everything else (empty click, unrelated node) → do nothing, keep state
});
// ── Document change handler (real-time edit reflection) ──
figma.on("documentchange", () => {
    if (lastActiveFrameId) {
        const frameNode = figma.getNodeById(lastActiveFrameId);
        if (frameNode) {
            scanFrame(lastActiveFrameId);
        }
    }
});
// ── Listen for UI messages ──────────────────
figma.ui.onmessage = (msg) => {
    if (msg.type === "close") {
        figma.closePlugin();
    }
    if (msg.type === "select-node" && msg.nodeId) {
        const node = figma.getNodeById(msg.nodeId);
        if (node && node.type === "TEXT") {
            isNavigating = true;
            figma.currentPage.selection = [node];
            figma.viewport.scrollAndZoomIntoView([node]);
        }
        else {
            figma.notify("⚠️ 레이어를 찾을 수 없습니다", { timeout: 2000 });
        }
    }
};
