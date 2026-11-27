// Adapter les exemples source aux primitives injectées de la console.
function prepareAgentExamples(source) {
    return source
        .replace(/^import\s*\{[^}]*\}\s*from\s*["']\.\/structure-langage-pour-ia["'];?\s*/, '')
        .replace(/\bconsole\.log\(/g, 'print(');
}

module.exports = { prepareAgentExamples };
