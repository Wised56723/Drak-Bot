// Importa o módulo sqlite3
const sqlite3 = require('sqlite3').verbose();

// Define o nome do arquivo do banco de dados
const DB_FILE = './drak.db';

// SQL para criar a Tabela 1: Usuarios (Sem mudança)
const CREATE_TABLE_USUARIOS = `
    CREATE TABLE IF NOT EXISTS Usuarios (
        id_discord TEXT PRIMARY KEY,
        nome TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
    );
`;

// SQL para criar a Tabela 2: Rifas (MODIFICADA)
// Adicionamos 'sorteio_data'
const CREATE_TABLE_RIFAS = `
    CREATE TABLE IF NOT EXISTS Rifas (
        id_rifa INTEGER PRIMARY KEY AUTOINCREMENT,
        nome_premio TEXT NOT NULL,
        total_bilhetes INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'ativa',
        
        metodo_sorteio TEXT NOT NULL, 
        meta_completude REAL,

        channel_id TEXT,
        message_id TEXT,

        preco_bilhete REAL NOT NULL,

        -- NOVO CAMPO --
        sorteio_data TEXT -- Armazena a data do sorteio (formato ISO)
    );
`;

// SQL para criar a Tabela 3: Compras (Sem mudança)
const CREATE_TABLE_COMPRAS = `
    CREATE TABLE IF NOT EXISTS Compras (
        id_compra INTEGER PRIMARY KEY AUTOINCREMENT,
        id_rifa_fk INTEGER NOT NULL,
        id_usuario_fk TEXT NOT NULL,
        data_compra DATETIME NOT NULL,
        quantidade INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'em_analise', 
        FOREIGN KEY (id_rifa_fk) REFERENCES Rifas (id_rifa),
        FOREIGN KEY (id_usuario_fk) REFERENCES Usuarios (id_discord)
    );
`;

// SQL para criar a Tabela 4: Bilhetes (Sem mudança)
const CREATE_TABLE_BILHETES = `
    CREATE TABLE IF NOT EXISTS Bilhetes (
        id_bilhete INTEGER PRIMARY KEY AUTOINCREMENT,
        id_compra_fk INTEGER NOT NULL,
        numero_bilhete TEXT NOT NULL,
        FOREIGN KEY (id_compra_fk) REFERENCES Compras (id_compra) ON DELETE CASCADE
    );
`;

// Conecta ao banco de dados e cria as tabelas
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error("Erro ao conectar ao DB:", err.message);
        throw err;
    }
    console.log('Conectado ao banco de dados drak.db.');
    
    db.serialize(() => {
        // 1. Cria tabela Usuarios
        db.run(CREATE_TABLE_USUARIOS, (err) => {
            if (err) console.error("Erro ao criar tabela Usuarios:", err.message);
            else console.log("Tabela 'Usuarios' verificada/criada.");
        });
        
        // 2. Cria tabela Rifas (agora atualizada)
        db.run(CREATE_TABLE_RIFAS, (err) => {
            if (err) console.error("Erro ao criar tabela Rifas:", err.message);
            else console.log("Tabela 'Rifas' verificada/criada.");
        });

        // 3. Cria tabela Compras
        db.run(CREATE_TABLE_COMPRAS, (err) => {
            if (err) console.error("Erro ao criar tabela Compras:", err.message);
            else console.log("Tabela 'Compras' verificada/criada.");
        });

        // 4. Cria tabela Bilhetes
        db.run(CREATE_TABLE_BILHETES, (err) => {
            if (err) console.error("Erro ao criar tabela Bilhetes:", err.message);
            else console.log("Tabela 'Bilhetes' verificada/criada.");
        });
    });
});

// Exporta o objeto 'db'
module.exports = db;