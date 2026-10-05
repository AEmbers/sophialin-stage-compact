// #1590: browser half of the dsh dual-face plugin (dsh.client). The tsup
// build wraps this CJS body in window.__ModuleLoader__.load({id, factory}) —
// two load-bearing invariants invisible from this file alone: the id MUST
// equal the loader entry name the scanner keys its graph row by ("loaded
// without registering" otherwise), and the factory's `require` resolves only
// through dsh's module system, so react is the sole permitted external. The
// host half (dsh-native.ts) injects globalThis.__BILI__ = {origin} into the
// web index; when absent the entry degrades to a hint instead of a dead link.

import { createElement } from "react";

type Dict = Record<string, string>;

type SlotOptions = { name: string; id: string; order: number; label: () => string; locale: string };

type ClientContext = {
    effect: (fn: () => void | (() => void), label?: string) => void;
    locale: {
        register: (ns: string, dict: { zh: Dict; en: Dict }) => void;
        bind: (ns: string) => (key: string) => string;
    };
    slots: {
        inject: (slot: string, provide: () => void) => void;
        register: (options: SlotOptions, component: (props: Record<string, unknown>) => unknown) => unknown;
    };
};

export const inject = ["slots", "locale"];

const NS = "bili";

const zh: Dict = {
    "nav": "bili设置",
    "title": "billion-context 压缩代理",
    "open": "打开 Web UI",
    "hint": "查看压缩状态、会话与上下文窗口。",
    "degraded": "当前 dsh 进程未绑定 bili 代理（未经 bili dsh 启动，或代理尚未就绪）——先运行 /acp，或改用 bili dsh 启动。",
};

const en: Dict = {
    "nav": "bili",
    "title": "billion-context compression proxy",
    "open": "Open Web UI",
    "hint": "Inspect compression status, sessions and context windows.",
    "degraded": "This dsh process is not bound to a bili proxy (not launched via bili dsh, or the proxy is not up yet) — run /acp first, or launch through bili dsh.",
};

function readOrigin(): string | undefined {
    const g = globalThis as { __BILI__?: { origin?: unknown } };
    const origin = g.__BILI__?.origin;
    return typeof origin === "string" && origin.length > 0 ? origin : undefined;
}

function openExternal(url: string): void {
    const w = globalThis as { open?: (url: string, target?: string, features?: string) => unknown };
    if (typeof w.open === "function") w.open(url, "_blank", "noopener,noreferrer");
}

export function apply(ctx: ClientContext): void {
    const zhDict = zh;
    const enDict = en;
    ctx.effect(
        () => ctx.locale.register(NS, { zh: zhDict, en: enDict }),
        "bili: dictionaries",
    );
    const t = ctx.locale.bind(NS);
    const section = (): unknown => {
        const origin = readOrigin();
        return createElement(
            "div",
            { style: { display: "flex", flexDirection: "column", gap: 12, padding: "20px 8px" } },
            createElement("h3", { style: { margin: 0, fontSize: 16, fontWeight: 600 } }, t("title")),
            origin === undefined
                ? createElement("p", { style: { margin: 0, opacity: 0.7, lineHeight: 1.6 } }, t("degraded"))
                : createElement(
                    "button",
                    {
                        type: "button",
                        onClick: () => openExternal(`${origin}/__bili/`),
                        style: {
                            alignSelf: "flex-start",
                            cursor: "pointer",
                            borderRadius: 8,
                            border: "1px solid rgba(127,127,127,0.4)",
                            background: "transparent",
                            color: "inherit",
                            fontFamily: "inherit",
                            fontSize: 14,
                            lineHeight: "22px",
                            padding: "7px 16px",
                        },
                    },
                    `${t("open")}（${origin}）`,
                ),
            createElement("p", { style: { margin: 0, opacity: 0.7, fontSize: 13, lineHeight: 1.6 } }, t("hint")),
        );
    };
    ctx.slots.inject(
        "settings.section",
        () => ctx.slots.register({ name: "settings.section", id: "bili", order: 100, label: () => t("nav"), locale: NS }, section),
    );
}
