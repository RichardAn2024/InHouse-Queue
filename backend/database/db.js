const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

let db;

async function initializeDatabase() {
    db = await open({
        filename: path.join(__dirname, 'database.sqlite'),
        driver: sqlite3.Database
    });

    // Criar tabelas
    await db.exec(`
        -- Tabela de jogadores na fila
        CREATE TABLE IF NOT EXISTS queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            puuid TEXT UNIQUE,
            rank TEXT,
            rankDivision TEXT,
            lp INTEGER,
            mmr INTEGER,
            summonerLevel INTEGER,
            profileIconId INTEGER,
            wins INTEGER,
            losses INTEGER,
            joinedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        -- Tabela de histórico de partidas
        CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            blueTeam TEXT,
            redTeam TEXT,
            blueTotalMMR INTEGER,
            redTotalMMR INTEGER
        );
        
        -- Tabela de estatísticas dos jogadores
        CREATE TABLE IF NOT EXISTS players_stats (
            puuid TEXT PRIMARY KEY,
            name TEXT,
            totalMatches INTEGER DEFAULT 0,
            totalWins INTEGER DEFAULT 0,
            totalLosses INTEGER DEFAULT 0,
            lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        -- Índices para melhor performance
        CREATE INDEX IF NOT EXISTS idx_queue_mmr ON queue(mmr);
        CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(playedAt);
    `);

    console.log('✅ Banco de dados inicializado');

    return db;
}

// Funções auxiliares
const dbHelpers = {
    async getQueue() {
        return await db.all('SELECT * FROM queue ORDER BY mmr DESC');
    },

    async addToQueue(player) {
        const result = await db.run(
            `INSERT INTO queue (name, puuid, rank, rankDivision, lp, mmr, summonerLevel, profileIconId, wins, losses)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [player.name, player.puuid, player.rank, player.rankDivision, player.lp,
            player.mmr, player.summonerLevel, player.profileIconId, player.wins, player.losses]
        );

        return await db.get('SELECT * FROM queue WHERE id = ?', result.lastID);
    },

    async removeFromQueue(playerId) {
        await db.run('DELETE FROM queue WHERE id = ?', playerId);
    },

    async clearQueue() {
        await db.run('DELETE FROM queue');
    },

    async saveMatch(blueTeam, redTeam) {
        const blueTotalMMR = blueTeam.reduce((sum, p) => sum + p.mmr, 0);
        const redTotalMMR = redTeam.reduce((sum, p) => sum + p.mmr, 0);

        // Salvar partida
        const result = await db.run(
            `INSERT INTO matches (blueTeam, redTeam, blueTotalMMR, redTotalMMR)
             VALUES (?, ?, ?, ?)`,
            [JSON.stringify(blueTeam), JSON.stringify(redTeam), blueTotalMMR, redTotalMMR]
        );

        // Atualizar estatísticas dos jogadores
        const allPlayers = [...blueTeam, ...redTeam];
        for (const player of allPlayers) {
            await db.run(
                `INSERT INTO players_stats (puuid, name, totalMatches)
                 VALUES (?, ?, 1)
                 ON CONFLICT(puuid) DO UPDATE SET
                 totalMatches = totalMatches + 1,
                 lastSeen = CURRENT_TIMESTAMP`,
                [player.puuid, player.name]
            );
        }

        return result.lastID;
    },

    async getStats() {
        const totalMatches = await db.get('SELECT COUNT(*) as count FROM matches');
        const uniquePlayers = await db.get('SELECT COUNT(*) as count FROM players_stats');

        // Calcular média de MMR baseado nos ranks
        const avgMMRResult = await db.get(`
            SELECT AVG(mmr) as avgMMR FROM (
                SELECT mmr FROM queue
                UNION ALL
                SELECT 
                    CASE 
                        WHEN rank = 'IRON' THEN 400
                        WHEN rank = 'BRONZE' THEN 800
                        WHEN rank = 'SILVER' THEN 1200
                        WHEN rank = 'GOLD' THEN 1600
                        WHEN rank = 'PLATINUM' THEN 2000
                        WHEN rank = 'DIAMOND' THEN 2400
                        WHEN rank = 'MASTER' THEN 2800
                        WHEN rank = 'GRANDMASTER' THEN 3200
                        WHEN rank = 'CHALLENGER' THEN 3600
                        ELSE 1200
                    END as mmr
                FROM players_stats
            )
        `);

        return {
            totalMatches: totalMatches.count,
            uniquePlayers: uniquePlayers.count,
            averageMMR: Math.round(avgMMRResult.avgMMR || 0)
        };
    },

    async resetStats() {
        await db.run('DELETE FROM matches');
        await db.run('DELETE FROM players_stats');
    },

    async getMatchHistory(limit = 10) {
        return await db.all(
            'SELECT * FROM matches ORDER BY playedAt DESC LIMIT ?',
            limit
        );
    },

    async getMatchDetails(matchId) {
        return await db.get('SELECT * FROM matches WHERE id = ?', matchId);
    }
};

module.exports = { initializeDatabase, ...dbHelpers };