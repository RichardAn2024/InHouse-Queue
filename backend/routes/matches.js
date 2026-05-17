const express = require('express');
const router = express.Router();
const db = require('../database/db');

// GET - Histórico de partidas
router.get('/history', async (req, res) => {
    try {
        const history = await db.getMatchHistory();
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET - Detalhes de uma partida específica
router.get('/:matchId', async (req, res) => {
    try {
        const match = await db.getMatchDetails(req.params.matchId);
        if (!match) {
            return res.status(404).json({ error: 'Partida não encontrada' });
        }
        res.json(match);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;