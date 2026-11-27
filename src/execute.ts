// Exécution d'un sous-ensemble TypeScript volontairement limité, sans eval ni VM.
import ts from 'typescript';
import * as api from './structure-langage-runtime';

const names = ['Ref','Phrase','Composition','variable','est','fait','contient','all','exists','and','or','not','implies','eq','select','quantification','query','addMemoryPhrase','addMemoryComposition','memoryRef','memoryRelation','memoryComposition','print'] as const;
const functions = new Map<string,any>(names.map(name => [name, api[name]]));
const constructors = new Set(['Ref', 'Phrase', 'Composition']);
const output:unknown[][] = [];
functions.set('print', (...args:unknown[]) => { output.push(args); });
const code = Buffer.from(process.argv[2] || '', 'base64').toString('utf8');
const mode = process.argv[3] || 'read';
const source = ts.createSourceFile('agent.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let steps = 0, callDepth = 0;
function tick() { if (++steps > 10000) throw new Error('Limite d’instructions'); }
function fail(node:ts.Node):never { throw new Error('Syntaxe non autorisée : ' + ts.SyntaxKind[node.kind]); }

type Binding = { value:unknown; mutable:boolean; initialized:boolean };
class Scope {
    private bindings = new Map<string,Binding>();
    constructor(private parent?:Scope) {}
    declare(name:string, mutable:boolean) {
        if (this.bindings.has(name)) throw new Error('Variable déjà déclarée : ' + name);
        this.bindings.set(name, { value:undefined, mutable, initialized:false });
    }
    initialize(name:string, value:unknown) {
        const binding = this.bindings.get(name)!;
        binding.value = value;
        binding.initialized = true;
    }
    private binding(name:string):Binding {
        const binding = this.bindings.get(name);
        if (binding) {
            if (!binding.initialized) throw new Error('Variable utilisée avant son initialisation : ' + name);
            return binding;
        }
        if (this.parent) return this.parent.binding(name);
        throw new Error('Variable inconnue : ' + name);
    }
    get(name:string) { return this.binding(name).value; }
    set(name:string, value:unknown) {
        const binding = this.binding(name);
        if (!binding.mutable) throw new Error('Modification d’une constante interdite : ' + name);
        binding.value = value;
        return value;
    }
}

type FunctionNode = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;
// Les objets visibles du programme ne contiennent ni AST, ni portée, ni fonction native.
class CallableValue {}
type Callable = { kind:'native'; name:string } | { kind:'script'; node:FunctionNode; scope:Scope };
const callables = new WeakMap<CallableValue,Callable>();
function callable(data:Callable):CallableValue {
    const value = new CallableValue();
    callables.set(value, data);
    return value;
}
const builtins = new Scope();
for (const name of names) {
    builtins.declare(name, false);
    builtins.initialize(name, callable({ kind:'native', name }));
}
const globalScope = new Scope(builtins);

function scriptFunction(node:FunctionNode, scope:Scope):CallableValue {
    if (!node.body || node.asteriskToken || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword)) fail(node);
    for (const parameter of node.parameters) {
        if (!ts.isIdentifier(parameter.name) || parameter.modifiers?.length ||
            (parameter.dotDotDotToken && (parameter.initializer || parameter !== node.parameters[node.parameters.length - 1]))) fail(parameter);
    }
    if (ts.isFunctionExpression(node) && node.name) {
        const local = new Scope(scope);
        const value = callable({ kind:'script', node, scope:local });
        local.declare(node.name.text, false);
        local.initialize(node.name.text, value);
        return value;
    }
    return callable({ kind:'script', node, scope });
}

function argumentsOf(nodes:ts.NodeArray<ts.Expression>, scope:Scope):unknown[] {
    const values:unknown[] = [];
    for (const node of nodes) {
        if (ts.isSpreadElement(node)) {
            const spread = expr(node.expression, scope);
            if (!Array.isArray(spread) && !(spread instanceof Set)) throw new Error('La décomposition exige un tableau ou un Set');
            for (const value of spread) { tick(); values.push(value); }
        } else values.push(expr(node, scope));
    }
    return values;
}

function call(value:unknown, args:unknown[]):unknown {
    tick();
    const data = value instanceof CallableValue ? callables.get(value) : undefined;
    if (!data) throw new Error('La valeur appelée n’est pas une fonction');
    if (data.kind === 'native') {
        if (constructors.has(data.name)) throw new Error('Utiliser new pour construire ' + data.name);
        // Vérifier la primitive réelle, même lorsqu’elle est appelée via un alias ou un paramètre.
        if (mode === 'read' && data.name.startsWith('addMemory')) throw new Error('Écriture interdite en mode read');
        return functions.get(data.name)(...args);
    }
    if (++callDepth > 128) { --callDepth; throw new Error('Profondeur maximale des appels dépassée'); }
    try {
        const local = new Scope(data.scope);
        for (const parameter of data.node.parameters) local.declare((parameter.name as ts.Identifier).text, true);
        data.node.parameters.forEach((parameter, index) => {
            tick();
            let argument = parameter.dotDotDotToken ? args.slice(index) : args[index];
            if (argument === undefined && parameter.initializer) argument = expr(parameter.initializer, local);
            local.initialize((parameter.name as ts.Identifier).text, argument);
        });
        const body = data.node.body!;
        return ts.isBlock(body) ? statements(body.statements, local, true)?.value : expr(body, local);
    } finally { --callDepth; }
}

function binary(node:ts.BinaryExpression, scope:Scope):any {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.EqualsToken) {
        if (!ts.isIdentifier(node.left)) return fail(node.left);
        return scope.set(node.left.text, expr(node.right, scope));
    }
    const left = expr(node.left, scope);
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return left && expr(node.right, scope);
    if (operator === ts.SyntaxKind.BarBarToken) return left || expr(node.right, scope);
    if (operator === ts.SyntaxKind.QuestionQuestionToken) return left ?? expr(node.right, scope);
    const right = expr(node.right, scope);
    switch (operator) {
        case ts.SyntaxKind.PlusToken: return left + right;
        case ts.SyntaxKind.MinusToken: return left - right;
        case ts.SyntaxKind.AsteriskToken: return left * right;
        case ts.SyntaxKind.AsteriskAsteriskToken: return left ** right;
        case ts.SyntaxKind.SlashToken: return left / right;
        case ts.SyntaxKind.PercentToken: return left % right;
        case ts.SyntaxKind.EqualsEqualsEqualsToken: return left === right;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken: return left !== right;
        case ts.SyntaxKind.EqualsEqualsToken: return left == right;
        case ts.SyntaxKind.ExclamationEqualsToken: return left != right;
        case ts.SyntaxKind.LessThanToken: return left < right;
        case ts.SyntaxKind.LessThanEqualsToken: return left <= right;
        case ts.SyntaxKind.GreaterThanToken: return left > right;
        case ts.SyntaxKind.GreaterThanEqualsToken: return left >= right;
        default: return fail(node);
    }
}

function expr(node:ts.Expression, scope:Scope):any {
    tick();
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isIdentifier(node)) return node.text === 'undefined' ? undefined : scope.get(node.text);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) return expr(node.expression, scope);
    if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return scriptFunction(node, scope);
    if (ts.isBinaryExpression(node)) return binary(node, scope);
    if (ts.isConditionalExpression(node)) return expr(expr(node.condition, scope) ? node.whenTrue : node.whenFalse, scope);
    if (ts.isPrefixUnaryExpression(node)) {
        const value = expr(node.operand, scope);
        switch (node.operator) {
            case ts.SyntaxKind.MinusToken: return -value;
            case ts.SyntaxKind.PlusToken: return +value;
            case ts.SyntaxKind.ExclamationToken: return !value;
            default: return fail(node);
        }
    }
    if (ts.isArrayLiteralExpression(node)) return argumentsOf(node.elements, scope);
    if (ts.isObjectLiteralExpression(node)) return Object.fromEntries(node.properties.map(property => {
        if (ts.isShorthandPropertyAssignment(property) && !property.objectAssignmentInitializer) return [property.name.text, scope.get(property.name.text)];
        if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))) return fail(property);
        return [property.name.text, expr(property.initializer, scope)];
    }));
    if (ts.isNewExpression(node)) {
        const value = expr(node.expression, scope);
        const data = value instanceof CallableValue ? callables.get(value) : undefined;
        if (!data || data.kind !== 'native' || !constructors.has(data.name)) return fail(node);
        const args = argumentsOf(node.arguments ?? ts.factory.createNodeArray(), scope);
        if (data.name === 'Ref' && args.length !== 0) throw new Error('Utiliser query pour retrouver une Ref existante');
        return new (functions.get(data.name))(...args);
    }
    if (ts.isCallExpression(node)) return call(expr(node.expression, scope), argumentsOf(node.arguments, scope));
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const object = expr(node.expression, scope);
        const key = ts.isPropertyAccessExpression(node) ? node.name.text : expr(node.argumentExpression, scope);
        if (object === null || typeof object !== 'object' || !['string','number'].includes(typeof key) || !Object.prototype.hasOwnProperty.call(object, key)) throw new Error('Propriété non accessible : ' + key);
        return object[key];
    }
    return fail(node);
}

type Completion = { value:unknown } | undefined;
function statement(node:ts.Statement, scope:Scope, inFunction:boolean):Completion {
    tick();
    if (ts.isFunctionDeclaration(node) || ts.isEmptyStatement(node)) return;
    if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) {
            scope.initialize((declaration.name as ts.Identifier).text, declaration.initializer ? expr(declaration.initializer, scope) : undefined);
        }
        return;
    }
    if (ts.isExpressionStatement(node)) { expr(node.expression, scope); return; }
    if (ts.isReturnStatement(node)) {
        if (!inFunction) return fail(node);
        return { value:node.expression ? expr(node.expression, scope) : undefined };
    }
    if (ts.isBlock(node)) return statements(node.statements, new Scope(scope), inFunction);
    if (ts.isIfStatement(node)) {
        if (expr(node.expression, scope)) return statement(node.thenStatement, scope, inFunction);
        if (node.elseStatement) return statement(node.elseStatement, scope, inFunction);
        return;
    }
    return fail(node);
}

function statements(nodes:ts.NodeArray<ts.Statement>, scope:Scope, inFunction:boolean):Completion {
    // Déclarations anticipées : appels avant la déclaration et fermetures lexicales.
    for (const node of nodes) {
        tick();
        if (ts.isFunctionDeclaration(node)) {
            if (!node.name) fail(node);
            scope.declare(node.name.text, true);
            scope.initialize(node.name.text, scriptFunction(node, scope));
        } else if (ts.isVariableStatement(node)) {
            for (const declaration of node.declarationList.declarations) {
                if (!ts.isIdentifier(declaration.name) || (!declaration.initializer && (node.declarationList.flags & ts.NodeFlags.Const))) fail(declaration);
                scope.declare(declaration.name.text, !(node.declarationList.flags & ts.NodeFlags.Const));
            }
        }
    }
    for (const node of nodes) {
        const completion = statement(node, scope, inFunction);
        if (completion) return completion;
    }
}

try {
    api.transaction(() => { statements(source.statements, globalScope, false); });
    process.stdout.write(JSON.stringify({ ok:true, output }, function(this:unknown,_key,value) {
        if(value===undefined&&!Array.isArray(this)) return {$undefined:true};
        return value instanceof Set ? [...value] : value instanceof CallableValue ? '[Function]' : value;
    }));
} catch (error) {
    process.stdout.write(JSON.stringify({ ok:false, error:error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
} finally { api.close(); }
