const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

test('Types : portées locales et parentes vérifiées dans Monaco et les deux moteurs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'semantic-variable-scopes-'));
    try {
        const cases = `
            const captured = all({ enfant: "Ref" }, phrase(variable("parent"), "aide", variable("enfant")));
            const parents = query(select({ parent: "Ref", unused: "string" }, captured));
            const parent: Ref = parents[0].parent;
            const unused: undefined = parents[0].unused;
            select({}, all({ x: "Ref" }, composition(variable("x"), "personne")));
            select({ parent: "Ref" }, all({ enfant: "Ref" }, exists({ projet: "Ref" }, and(
                phrase(variable("parent"), "aide", variable("enfant")),
                phrase(variable("enfant"), "prépare", variable("projet"))
            ))));
            select({ parent: "Ref" }, ["all", { enfant: "Ref" }, ["exists", { projet: "Ref" },
                ["phrase", ["var", "parent"], "aide", ["var", "enfant"], ["var", "projet"]]
            ]]);
            select({}, quantification(["exists", { x: "Ref" }, composition(variable("x"), "personne")]));
            select({}, all({ a: "Ref" }, exists({ b: "Ref" }, all({ c: "Ref" }, exists({ d: "Ref" },
                all({ e: "Ref" }, exists({ f: "Ref" }, all({ g: "Ref" }, phrase(variable("a"), "aide", variable("g")))))
            )))));
            select({}, and(all({ x: "Ref" }, eq(variable("x"), variable("x"))),
                exists({ x: "number" }, eq(variable("x"), 1))));
            const shadow = query(select({ x: "string" }, all({ x: "Ref" }, composition(variable("x"), "personne"))));
            const hidden: undefined = shadow[0].x;
            query(["select", { parent: "Ref" }, captured]);
            const typed: Query<{ parent: "Ref" }, typeof captured> = ["select", { parent: "Ref" }, captured];
            const typedParent: Ref = query(typed)[0].parent;
            function dynamic(q: Query<{ parent: "Ref" }>, expression: Expression<{ parent: "Ref" }>) {
                query(q);
                select({ parent: "Ref" }, expression);
            }
            // @ts-expect-error La variable parent capturée doit être déclarée par select.
            select({}, captured);
            // @ts-expect-error Une autre déclaration extérieure ne satisfait pas la capture.
            select({ autre: "Ref" }, captured);
            // @ts-expect-error Variable absente de toutes les portées, sous deux quantificateurs.
            select({ parent: "Ref" }, all({ enfant: "Ref" }, exists({ projet: "Ref" }, phrase(variable("absent"), "aide", variable("enfant")))));
            // @ts-expect-error Les noms restent vérifiés dans une imbrication plus profonde.
            select({}, all({ a: "Ref" }, exists({ b: "Ref" }, all({ c: "Ref" }, exists({ d: "Ref" }, all({ e: "Ref" }, exists({ f: "Ref" }, all({ g: "Ref" }, phrase(variable("absent"), "aide", variable("g"))))))))));
            // @ts-expect-error Une variable locale ne sort pas de son quantificateur.
            select({}, and(all({ enfant: "Ref" }, true), phrase(variable("enfant"), "dort")));
            // @ts-expect-error Une variable déclarée dans une branche ne lie pas sa voisine.
            select({}, and(all({ enfant: "Ref" }, true), exists({ projet: "Ref" }, phrase(variable("enfant"), "prépare", variable("projet")))));
            // @ts-expect-error La déclaration dans le quantificateur intérieur ne remonte pas.
            select({}, all({ parent: "Ref" }, and(exists({ enfant: "Ref" }, true), phrase(variable("enfant"), "dort"))));
            // @ts-expect-error Les tuples bruts suivent les mêmes règles.
            select({}, ["all", { enfant: "Ref" }, ["phrase", ["var", "absent"], "aide", ["var", "enfant"]]]);
            // @ts-expect-error all conserve les noms littéraux des tuples bruts.
            select({}, all({ enfant: "Ref" }, ["phrase", ["var", "absent"], "aide", ["var", "enfant"]]));
            // @ts-expect-error Les helpers logiques conservent aussi les noms littéraux.
            select({}, all({ enfant: "Ref" }, not(and(["composition", ["var", "absent"], "personne"]))));
            // @ts-expect-error Les helpers de faits conservent les noms littéraux.
            select({}, exists({ enfant: "Ref" }, composition(["var", "absent"], "personne")));
            // @ts-expect-error La portée s'applique aussi aux quantifications construites directement.
            select({}, quantification(["all", { enfant: "Ref" }, phrase(variable("absent"), "dort")]));
            // @ts-expect-error Un tuple envoyé directement à query est également vérifié.
            query(["select", {}, captured]);
            // @ts-expect-error Query avec une expression précise conserve la vérification.
            const invalid: Query<{}, typeof captured> = ["select", {}, captured];
        `;
        const imports = 'Ref, Query, Expression, all, exists, select, query, phrase, composition, variable, eq, and, not, quantification';
        const variants = [
            ['monaco', 'export {};'],
            ['sqlite', `import { ${imports} } from ${JSON.stringify(resolve('src/structure-langage-runtime'))};`],
            ['ram', `import { ${imports} } from ${JSON.stringify(resolve('src/structure-langage-pour-ia'))};`]
        ];
        const files = variants.map(([name, prefix]) => {
            const file = join(dir, name + '.ts');
            writeFileSync(file, prefix + '\n' + cases);
            return file;
        });
        const direct = join(dir, 'runtime.ts');
        writeFileSync(direct, `
            import { Runtime } from ${JSON.stringify(resolve('src/runtime'))};
            import { all, phrase, variable } from ${JSON.stringify(resolve('src/structure-langage'))};
            declare const db: Runtime;
            const captured = all({ enfant: "Ref" }, phrase(variable("parent"), "aide", variable("enfant")));
            db.query(["select", { parent: "Ref" }, captured]);
            // @ts-expect-error Le moteur SQLite vérifie aussi les tuples passés directement.
            db.query(["select", {}, captured]);
        `);
        const program = ts.createProgram([resolve('dist/editor/structure-langage.d.ts'), ...files, direct], {
            noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
            resolveJsonModule: true, esModuleInterop: true,
            lib: ['lib.es2022.d.ts'], types: ['node'], typeRoots: [resolve('node_modules/@types')]
        });
        const diagnostics = ts.getPreEmitDiagnostics(program).map(d => {
            const line = d.file && d.file.getLineAndCharacterOfPosition(d.start).line + 1;
            return `${d.file?.fileName}:${line}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
        });
        assert.deepEqual(diagnostics, []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
