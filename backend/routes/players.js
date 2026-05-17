const express = require('express');
const router = express.Router();
const axios = require('axios');
const db = require('../database/db');

// Configuração da API da Riot
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const REGION = 'br1'; // Brasil

// Função para buscar dados do invocador
async function getSummonerInfo(summonerName) {
    try {
        // Buscar invocador pelo nome
        const summonerResponse = await axios.get(
            `https://${REGION}.api.riotgames.com/lol/summoner/v4/summoners/by-name/${encodeURIComponent(summonerName)}`,
            {
                headers: { 'X-Riot-Token': RIOT_API_KEY }
            }
        );

        const summoner = summonerResponse.data;

        // Buscar ranked info (solo/duo)
        const rankedResponse = await axios.get(
            `https://${REGION}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summoner.id}`,
            {
                headers: { 'X-Riot-Token': RIOT_API_KEY }
            }
        );

        // Encontrar o ranked solo/duo
        const soloRanked = rankedResponse.data.find(
            queue => queue.queueType === 'RANKED_SOLO_5x5'
        );

        return {
            name: summoner.name,
            puuid: summoner.puuid,
            summonerLevel: summoner.summonerLevel,
            rank: soloRanked ? soloRanked.tier : 'UNRANKED',
            rankDivision: soloRanked ? soloRanked.rank : '',
            lp: soloRanked ? soloRanked.leaguePoints : 0,
            wins: soloRanked ? soloRanked.wins : 0,
            losses: soloRanked ? soloRanked.losses : 0,
            profileIconId: summoner.profileIconId
        };
    } catch (error) {
        console.error('Erro ao buscar summoner:', error.response?.data || error.message);

        if (error.response?.status === 404) {
            throw new Error('Invocador não encontrado');
        } else if (error.response?.status === 403) {
            throw new Error('API Key inválida ou expirada');
        } else {
            throw new Error('Erro ao buscar dados da Riot API');
        }
    }
}

// Converter rank para MMR aproximado
function rankToMMR(tier, division) {
    const tierValues = {
        'IRON': 400,
        'BRONZE': 800,
        'SILVER': 1200,
        'GOLD': 1600,
        'PLATINUM': 2000,
        'DIAMOND': 2400,
        'MASTER': 2800,
        'GRANDMASTER': 3200,
        'CHALLENGER': 3600,
        'UNRANKED': 800
    };

    const divisionValues = {
        'IV': 0,
        'III': 100,
        'II': 200,
        'I': 300
    };

    let mmr = tierValues[tier] || 1200;

    if (division && divisionValues[division]) {
        mmr += divisionValues[division];
    }

    return mmr;
}

// GET - Listar todos os jogadores na fila
router.get('/queue', async (req, res) => {
    try {
        const queue = await db.getQueue();
        res.json(queue);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST - Adicionar jogador à fila (busca da API da Riot)
router.post('/add', async (req, res) => {
    const { summonerName } = req.body;

    if (!summonerName) {
        return res.status(400).json({ error: 'Nome do invocador é obrigatório' });
    }

    try {
        // Buscar dados do summoner na API da Riot
        const summonerData = await getSummonerInfo(summonerName);

        // Calcular MMR baseado no rank
        const mmr = rankToMMR(summonerData.rank, summonerData.rankDivision);

        // Adicionar à fila
        const player = await db.addToQueue({
            name: summonerData.name,
            puuid: summonerData.puuid,
            rank: summonerData.rank,
            rankDivision: summonerData.rankDivision,
            lp: summonerData.lp,
            mmr: mmr,
            summonerLevel: summonerData.summonerLevel,
            profileIconId: summonerData.profileIconId,
            wins: summonerData.wins,
            losses: summonerData.losses
        });

        res.json({
            success: true,
            player,
            message: `${summonerData.name} foi adicionado à fila!`
        });

    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// DELETE - Remover jogador da fila
router.delete('/remove/:playerId', async (req, res) => {
    try {
        await db.removeFromQueue(req.params.playerId);
        res.json({ success: true, message: 'Jogador removido da fila' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE - Limpar toda a fila
router.delete('/clear-queue', async (req, res) => {
    try {
        await db.clearQueue();
        res.json({ success: true, message: 'Fila limpa com sucesso' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST - Formar times (balanceamento automático)
router.post('/balance', async (req, res) => {
    try {
        const queue = await db.getQueue();

        if (queue.length !== 10) {
            return res.status(400).json({
                error: `São necessários exatamente 10 jogadores. Atualmente: ${queue.length}`
            });
        }

        // Ordenar por MMR (do maior para o menor)
        const sorted = [...queue].sort((a, b) => b.mmr - a.mmr);

        // Distribuição serpentina balanceada
        const blue = [];
        const red = [];

        sorted.forEach((player, index) => {
            if (index === 0) blue.push(player);
            else if (index === 1) red.push(player);
            else if (index === 2) red.push(player);
            else if (index === 3) blue.push(player);
            else if (index === 4) blue.push(player);
            else if (index === 5) red.push(player);
            else if (index === 6) red.push(player);
            else if (index === 7) blue.push(player);
            else if (index === 8) blue.push(player);
            else if (index === 9) red.push(player);
        });

        // Salvar partida no histórico
        const matchId = await db.saveMatch(blue, red);

        // Limpar fila
        await db.clearQueue();

        res.json({
            success: true,
            matchId,
            blue,
            red,
            blueTotalMMR: blue.reduce((sum, p) => sum + p.mmr, 0),
            redTotalMMR: red.reduce((sum, p) => sum + p.mmr, 0)
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET - Estatísticas
router.get('/stats', async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST - Resetar estatísticas
router.post('/reset-stats', async (req, res) => {
    try {
        await db.resetStats();
        res.json({ success: true, message: 'Estatísticas resetadas' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;