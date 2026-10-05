// #1590: ambient surface of "react" for the dsh client bundle. The real
// module arrives at runtime through dsh's browser module system (the
// factory `require` of the __ModuleLoader__ wrapper) and is marked external
// in the client tsup build — no react devDependency is installed.
declare module "react" {
    export function createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
}
