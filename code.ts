// ─────────────────────────────────────────────
// Text Finder — Figma Plugin (Sandbox Code)
// ─────────────────────────────────────────────

interface TextRowData {
    textContent: string;
    styleName: string;
    fontSize: string;
    fontFamily: string;
    letterSpacing: string;
    lineHeight: string;
    isUnlinked: boolean;
}

// ── Recursive TEXT node finder (skips invisible) ──
function findVisibleTextNodes(node: SceneNode): TextNode[] {
    // Skip hidden nodes entirely
    if (!node.visible) return [];

    if (node.type === "TEXT") return [node];

    if ("children" in node) {
        return (node as ChildrenMixin & SceneNode).children.flatMap(findVisibleTextNodes);
    }
    return [];
}

// ── Style name resolver ─────────────────────
function resolveStyleName(textStyleId: TextNode["textStyleId"]): { name: string; unlinked: boolean } {
    if (textStyleId === figma.mixed) {
        return { name: "🟡 Mixed", unlinked: false };
    }

    if (!textStyleId || textStyleId === "") {
        return { name: "🔴 미연결", unlinked: true };
    }

    // Use sync API
    try {
        const s = figma.getStyleById(textStyleId as string);
        if (s && s.name) {
            return { name: s.name, unlinked: false };
        }
    } catch (_) {
        // Style may not be accessible (remote library)
    }

    return { name: "🔴 미연결", unlinked: true };
}

// ── Format helpers ──────────────────────────
function formatFontSize(fontSize: TextNode["fontSize"]): string {
    if (fontSize === figma.mixed) return "Mixed";
    return `${Math.round(fontSize)}`;
}

function formatFontFamily(fontName: TextNode["fontName"]): string {
    if (fontName === figma.mixed) return "Mixed";
    return `${fontName.family} ${fontName.style}`;
}

function formatLetterSpacing(ls: TextNode["letterSpacing"]): string {
    if (ls === figma.mixed) return "Mixed";
    if (ls.unit === "PERCENT") return `${parseFloat(ls.value.toFixed(2))}%`;
    return `${parseFloat(ls.value.toFixed(2))}px`;
}

function formatLineHeight(lh: TextNode["lineHeight"]): string {
    if (lh === figma.mixed) return "Mixed";
    if (lh.unit === "AUTO") return "Auto";
    if (lh.unit === "PERCENT") return `${parseFloat(lh.value.toFixed(2))}%`;
    return `${parseFloat(lh.value.toFixed(2))}px`;
}

// ── Extract row data from a TEXT node ───────
function extractData(node: TextNode): TextRowData {
    const styleInfo = resolveStyleName(node.textStyleId);
    return {
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

const selection = figma.currentPage.selection;

if (selection.length === 0) {
    figma.notify("⚠️ 대상을 선택해주세요", { timeout: 3000 });
    figma.closePlugin();
} else {
    const textNodes = selection.flatMap(findVisibleTextNodes);

    if (textNodes.length === 0) {
        figma.notify("⚠️ 선택 영역에 보이는 텍스트 레이어가 없습니다", { timeout: 3000 });
        figma.closePlugin();
    } else {
        const rows: TextRowData[] = textNodes.map(extractData);
        figma.ui.postMessage({ type: "result", data: rows });
    }
}

// Listen for UI messages
figma.ui.onmessage = (msg: { type: string }) => {
    if (msg.type === "close") {
        figma.closePlugin();
    }
};
