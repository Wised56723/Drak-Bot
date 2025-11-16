// src/utils/Logger.ts

import "colors";

export type LogContext = 
    | "Cliente" 
    | "Comando" 
    | "Botao" 
    | "Modal" 
    | "GestaoService" 
    | "RifaService" 
    | "Loteria" 
    | "Desconhecido";

// Função de log genérica
function log(level: "INFO" | "WARN" | "ERROR", context: LogContext, message: string, error?: any) {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const logPrefix = `[${timestamp} | ${level.padEnd(5)}]`.grey;
    const contextPrefix = `[${context}]`.bold;

    let logMessage = `${logPrefix} ${contextPrefix} ${message}`;

    if (level === "INFO") console.log(logMessage.cyan);
    if (level === "WARN") {
        // --- CORREÇÃO AQUI ---
        // Agora o 'warn' também logará o erro se ele for passado
        console.warn(logMessage.yellow);
        if (error) {
            console.warn(String(error.stack || error).yellow);
        }
        // --- FIM DA CORREÇÃO ---
    }
    if (level === "ERROR") {
        console.error(logMessage.red);
        if (error) {
            console.error(String(error.stack || error).red);
        }
    }
}

// Exportamos funções específicas para cada nível
export const Logger = {
    /** Log de informação geral (ex: Bot online, Comando carregado) */
    info: (context: LogContext, message: string) => {
        log("INFO", context, message);
    },

    /** Log de aviso (ex: Handler não encontrado, mas não é um erro crítico) */
    // --- CORREÇÃO AQUI ---
    // Adicionamos o 'error?: any' opcional
    warn: (context: LogContext, message: string, error?: any) => {
        log("WARN", context, message, error);
    },
    // --- FIM DA CORREÇÃO ---

    /** Log de erro (ex: Falha no banco de dados, erro na API do Discord) */
    error: (context: LogContext, message: string, error: any) => {
        log("ERROR", context, message, error);
    }
};