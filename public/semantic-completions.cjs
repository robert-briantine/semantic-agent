// Exécuté dans le worker TypeScript : réutiliser son AST plutôt qu’analyser le code par regex.
function variableCompletions(ts, source, position, checker) {
    let literal;
    function find(node) {
        if (node.getStart(source) > position || node.end < position) return;
        if (ts.isStringLiteralLike(node)) {
            const start = node.getStart(source);
            const end = node.end - (node.isUnterminated ? 0 : 1);
            if (position > start && position <= end) literal = node;
        }
        ts.forEachChild(node, find);
    }
    find(source);
    if (!literal) return;
    const call = literal.parent;
    if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== 'variable' || call.arguments[0] !== literal) return;

    const bindings = new Map();
    function unwrap(node) {
        while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
        return node;
    }
    function addBindings(argument) {
        const object = unwrap(argument);
        if (!object) return;
        if (checker) {
            for (const symbol of checker.getTypeAtLocation(object).getProperties()) {
                const type = checker.getTypeOfSymbolAtLocation(symbol, object);
                if (!bindings.has(symbol.name)) bindings.set(symbol.name, checker.typeToString(type));
            }
        } else if (ts.isObjectLiteralExpression(object)) {
            for (const property of object.properties) {
                if (!ts.isPropertyAssignment(property) || (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name))) continue;
                if (!bindings.has(property.name.text)) bindings.set(property.name.text, property.initializer.getText(source));
            }
        }
    }
    for (let child = call, parent = call.parent; parent; child = parent, parent = parent.parent) {
        if (!ts.isCallExpression(parent) || !ts.isIdentifier(parent.expression) || parent.arguments[1] !== child) continue;
        const name = parent.expression.text;
        if (name === 'select' || name === 'all' || name === 'exists') {
            addBindings(parent.arguments[0]);
            // Une requête imbriquée possède sa propre portée.
            if (name === 'select') break;
        }
    }
    const start = literal.getStart(source) + 1;
    const end = literal.end - (literal.isUnterminated ? 0 : 1);
    const quote = source.text[start - 1];
    function escape(name) {
        const escaped = JSON.stringify(name).slice(1, -1);
        return quote === "'" ? escaped.replace(/'/g, "\\'") : quote === '`' ? escaped.replace(/`/g, '\\`').replace(/\$\{/g, '\\${') : escaped;
    }
    return [...bindings].map(([name, type]) => ({
        name: escape(name), type, replacementSpan: { start, length: end - start }
    }));
}

module.exports = { variableCompletions };
