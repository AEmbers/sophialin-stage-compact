import test from "node:test";
import assert from "node:assert/strict";
import { lookupContextLimit, resolveContextLimit } from "../src/config.ts";
import { modelRoots } from "../src/model-id.ts";
import { bundledSnapshotLookup } from "../src/registry.ts";

test("modelRoots tries the namespace-stripped form after the full id", () => {
    assert.deepEqual(modelRoots("cn:deepseek-v4.1-flash"), ["cn:deepseek-v4.1-flash", "deepseek-v4.1-flash"]);
    assert.deepEqual(
        modelRoots("openrouter:google/gemini-2.5-pro"),
        ["openrouter:google/gemini-2.5-pro", "google/gemini-2.5-pro", "gemini-2.5-pro"],
    );
});

test("modelRoots keeps the relay basename rule and is a no-op for bare ids", () => {
    assert.deepEqual(modelRoots("deepseek/deepseek-v4.1-flash"), ["deepseek/deepseek-v4.1-flash", "deepseek-v4.1-flash"]);
    assert.deepEqual(modelRoots("meta-llama/Llama-4"), ["meta-llama/Llama-4", "Llama-4"]);
    assert.deepEqual(modelRoots("gpt-4o"), ["gpt-4o"]);
});

test("a namespaced model id resolves through the built-in table (#window-namespace)", () => {
    assert.equal(lookupContextLimit("deepseek-v4.1-flash"), 1_000_000);
    assert.equal(lookupContextLimit("cn:deepseek-v4.1-flash"), 1_000_000);
    assert.equal(lookupContextLimit("cn:glm-5.3-flash"), 1_000_000);
    assert.equal(lookupContextLimit("cn:hy4-preview"), undefined);
});

test("resolveContextLimit no longer needs a per-route declaration for a namespaced id", () => {
    // The reported bug: the host sends "cn:deepseek-v4.1-flash", no configured
    // route matches the real upstream, and the 200k env default collapsed the
    // effective window to 200k x 0.75 = 150k.
    assert.equal(
        resolveContextLimit({}, "http://192.168.31.112:7864/v1/chat/completions", "cn:deepseek-v4.1-flash"),
        1_000_000,
    );
});

test("an unrecognized namespaced id still falls through to the env default", () => {
    assert.equal(lookupContextLimit("cn:some-unknown-model"), undefined);
    assert.equal(lookupContextLimit("totally-unknown-model"), undefined);
});

test("registry lookup resolves a namespaced id through the provider-prefixed key", () => {
    const bare = bundledSnapshotLookup("deepseek-v4.1-flash");
    assert.equal(typeof bare, "number");
    assert.equal(bundledSnapshotLookup("cn:deepseek-v4.1-flash"), bare);
});

test("the full id keeps precedence over its stripped forms", () => {
    // "qwen/gpt-4.1": the qwen family pattern matches first (200k) even though
    // the basename alone would hit the 1M gpt-4.1 row.
    assert.equal(lookupContextLimit("qwen/gpt-4.1"), 200_000);
});
