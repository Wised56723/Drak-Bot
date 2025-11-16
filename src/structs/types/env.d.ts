declare namespace NodeJS {
  interface ProcessEnv {
    BOT_TOKEN: string;
    CLIENT_ID: string;
    // --- NOVAS VARIÁVEIS DE CONFIGURAÇÃO ---
    MEMBRO_REGISTADO_ROLE_ID: string;
    LOG_CHANNEL_ID: string;
    PIX_KEY: string;
    PIX_MERCHANT_NAME: string;
    PIX_MERCHANT_CITY: string;
    // --- FIM NOVAS VARIÁVEIS ---
  }
}