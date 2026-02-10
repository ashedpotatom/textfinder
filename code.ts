// ─────────────────────────────────────────────
// Text Finder — Figma Plugin (Sandbox Code)
// ─────────────────────────────────────────────

interface TextRowData {
    nodeId: string;
    textContent: string;
    styleName: string;
    fontSize: string;
    fontFamily: string;
    letterSpacing: string;
    lineHeight: string;
    isUnlinked: boolean;
    isModified: boolean;
}

// ── Recursive TEXT node finder (skips invisible) ──
function findVisibleTextNodes(node: SceneNode): TextNode[] {
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
        return { name: "🔴 Unlinked", unlinked: true };
    }
    try {
        const s = figma.getStyleById(textStyleId as string);
        if (s && s.name) {
            return { name: s.name, unlinked: false };
        }
    } catch (_) { }
    return { name: "🔴 Unlinked", unlinked: true };
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

// ── Extract row data ────────────────────────
function extractData(node: TextNode): TextRowData {
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
let lastActiveFrameId: string | null = null;
let isNavigating = false;
const originalDataMap = new Map<string, string>();

// ── Serialize row for comparison ────────────
function serializeRow(r: TextRowData): string {
    return JSON.stringify({ t: r.textContent, s: r.styleName, fs: r.fontSize, ff: r.fontFamily, ls: r.letterSpacing, lh: r.lineHeight });
}

// ── Take snapshot of initial state ──────────
function takeSnapshot(rows: TextRowData[]) {
    originalDataMap.clear();
    for (const r of rows) {
        originalDataMap.set(r.nodeId, serializeRow(r));
    }
}

// ── Mark modified rows by comparing to snapshot ──
function markModified(rows: TextRowData[]): TextRowData[] {
    return rows.map(r => ({
        ...r,
        isModified: originalDataMap.has(r.nodeId) && originalDataMap.get(r.nodeId) !== serializeRow(r),
    }));
}

const CONTAINER_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "GROUP"]);

// ── Check if a node is a descendant of a specific frame ──
function isChildOf(node: BaseNode, ancestorId: string): boolean {
    let current = node.parent;
    while (current) {
        if (current.id === ancestorId) return true;
        current = current.parent;
    }
    return false;
}

// ── Scan a specific frame by ID & send to UI ──
function scanFrame(frameId: string, isNewContext: boolean = false) {
    const frameNode = figma.getNodeById(frameId);
    if (!frameNode || !("children" in frameNode)) {
        figma.ui.postMessage({ type: "no-text" });
        return;
    }

    const textNodes = (frameNode as ChildrenMixin & SceneNode).children.flatMap(findVisibleTextNodes);

    // Sort by visual order: top-to-bottom (Y), then left-to-right (X)
    textNodes.sort((a, b) => {
        const ay = a.absoluteTransform[1][2];
        const by = b.absoluteTransform[1][2];
        if (ay !== by) return ay - by;
        return a.absoluteTransform[0][2] - b.absoluteTransform[0][2];
    });

    if (textNodes.length === 0) {
        figma.ui.postMessage({ type: "no-text" });
        return;
    }

    let rows: TextRowData[] = textNodes.map(extractData);

    if (isNewContext) {
        // New frame selected → take snapshot, no modifications yet
        rows = rows.map(r => ({ ...r, isModified: false }));
        takeSnapshot(rows);
    } else {
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
    } else {
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

    // Case B: Selected node is a child of the active frame → sync highlight
    if (lastActiveFrameId && selection.length > 0) {
        const childNodes = selection.filter(n => isChildOf(n, lastActiveFrameId!));
        if (childNodes.length > 0) {
            const ids = childNodes.map(n => n.id);
            figma.ui.postMessage({ type: "sync-selection", ids: ids });
            return;
        }
    }

    // Case C: Selection is unrelated to active frame → valid "Strict Mode" reset
    // If we're here, it means we selected something that isn't a Frame, and isn't inside the current Frame.
    lastActiveFrameId = null;
    figma.ui.postMessage({ type: "empty" });
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
figma.ui.onmessage = (msg: any) => {
    if (msg.type === "close") {
        figma.closePlugin();
    }

    // Single node select (legacy / row click)
    if (msg.type === "select-node" && msg.nodeId) {
        const node = figma.getNodeById(msg.nodeId);
        if (node && node.type === "TEXT") {
            isNavigating = true;
            figma.currentPage.selection = [node as SceneNode];
            figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
        } else {
            figma.notify("⚠️ 레이어를 찾을 수 없습니다", { timeout: 2000 });
        }
    }

    // Multi-node select
    if (msg.type === "select-nodes" && msg.ids && msg.ids.length > 0) {
        const nodes: SceneNode[] = [];
        for (const id of msg.ids) {
            const node = figma.getNodeById(id);
            if (node) nodes.push(node as SceneNode);
        }
        if (nodes.length > 0) {
            isNavigating = true;
            figma.currentPage.selection = nodes;
            figma.viewport.scrollAndZoomIntoView(nodes);
            // Zoom out slightly for breathing room
            figma.viewport.zoom = figma.viewport.zoom * 0.8;
        } else {
            figma.notify("⚠️ 레이어를 찾을 수 없습니다", { timeout: 2000 });
        }
    }

    // Create image on canvas from captured table
    if (msg.type === "create-image" && msg.bytes) {
        const bytes = new Uint8Array(msg.bytes);
        const image = figma.createImage(bytes);
        const rect = figma.createRectangle();

        // Retina: canvas size is 2x, so display at half
        const displayWidth = msg.width / 2;
        const displayHeight = msg.height / 2;
        rect.resize(displayWidth, displayHeight);
        rect.name = "Text Finder Capture";

        // Fill with the captured image
        rect.fills = [{
            type: "IMAGE",
            imageHash: image.hash,
            scaleMode: "FILL"
        }];

        // Position: right of the active frame, or viewport center
        if (lastActiveFrameId) {
            const frameNode = figma.getNodeById(lastActiveFrameId);
            if (frameNode && "x" in frameNode && "width" in frameNode) {
                const sn = frameNode as SceneNode;
                rect.x = sn.x + sn.width + 50;
                rect.y = sn.y;
            } else {
                const center = figma.viewport.center;
                rect.x = center.x - displayWidth / 2;
                rect.y = center.y - displayHeight / 2;
            }
        } else {
            const center = figma.viewport.center;
            rect.x = center.x - displayWidth / 2;
            rect.y = center.y - displayHeight / 2;
        }

        // Select and focus
        isNavigating = true;
        figma.currentPage.selection = [rect];
        figma.viewport.scrollAndZoomIntoView([rect]);
        figma.notify("✅ 테이블 이미지가 캔버스에 추가되었습니다", { timeout: 2000 });
    }
};
