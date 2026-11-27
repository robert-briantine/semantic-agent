import { initialize, TypeScriptWorker, ts as services } from 'monaco-editor/languages/features/typescript/ts.worker';
import { variableCompletions } from './semantic-completions.cjs';

const ts = services.typescript;
class SemanticTypeScriptWorker extends TypeScriptWorker {
    variableSuggestions(fileName, position) {
        const program = this.getLanguageService().getProgram();
        const source = program?.getSourceFile(fileName);
        return source && variableCompletions(ts, source, position, program.getTypeChecker());
    }

    async getCompletionsAtPosition(fileName, position) {
        const variables = this.variableSuggestions(fileName, position);
        if (!variables) return super.getCompletionsAtPosition(fileName, position);
        return {
            isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false,
            entries: variables.map(variable => ({ name: variable.name, kind: ts.ScriptElementKind.variableElement,
                kindModifiers: '', sortText: '0', replacementSpan: variable.replacementSpan }))
        };
    }

    async getCompletionEntryDetails(fileName, position, name) {
        const variable = this.variableSuggestions(fileName, position)?.find(item => item.name === name);
        if (!variable) return super.getCompletionEntryDetails(fileName, position, name);
        return { name, kind: ts.ScriptElementKind.variableElement, kindModifiers: '',
            displayParts: [{ text: `${name} : ${variable.type}`, kind: 'text' }],
            documentation: [{ text: 'Variable déclarée dans la portée de cette expression.', kind: 'text' }] };
    }
}

self.onmessage = () => initialize((context, data) => new SemanticTypeScriptWorker(context, data));
