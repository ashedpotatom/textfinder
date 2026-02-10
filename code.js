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
    };
}
// ── Main ────────────────────────────────────
figma.showUI(__html__, { width: 780, height: 520, themeColors: true });
// ── Scan current selection & send to UI ─────
function scanSelection() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        figma.ui.postMessage({ type: "empty" });
        return;
    }
    const textNodes = selection.flatMap(findVisibleTextNodes);
    if (textNodes.length === 0) {
        figma.ui.postMessage({ type: "no-text" });
        return;
    }
    const rows = textNodes.map(extractData);
    figma.ui.postMessage({ type: "result", data: rows });
}
// Run on startup
scanSelection();
// Re-scan whenever selection changes (skip if triggered by UI click)
figma.on("selectionchange", () => {
    if (isNavigating) {
        isNavigating = false;
        return;
    }
    scanSelection();
});
// ── Navigation flag ─────────────────────────
let isNavigating = false;
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
