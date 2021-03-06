const PORT = 1919;

const bodyParser = require('body-parser');
const cors = require('cors');
const express = require('express');
const morgan = require('morgan');
const path = require('path');
const WebSocket = require('ws');

const INDEXES = [0, 1, 2];

// This is a map where keys are game ids
// and values are game objects.
// A game object contains:
// id: number
// player1: String (always uses "X" marker)
// player2: String (always uses "O" marker)
// lastMarker: String ("X" or "O")
// winner: String
// board: Number[][]
const gameMap = {};

let webSockets = [];
const wss = new WebSocket.Server({port: 1920});
wss.on('connection', ws => webSockets.push(ws));

const app = express();
app.use(cors());
app.use(morgan('short'));
app.use(express.static(path.resolve(__dirname, '../dist')));
app.use(bodyParser.json({limit: '4mb'}));

function columnWin(board, marker, column) {
  const boardColumn = board.map(boardRow => boardRow[column]);
  return boardColumn.every(position => position === marker);
}

function diagonalWin(board, marker) {
  const diag1 = INDEXES.map(index => board[index][index]);
  const diag2 = INDEXES.map(index => board[index][2 - index]);
  return (
    diag1.every(position => position === marker) ||
    diag2.every(position => position === marker)
  );
}

function rowWin(board, marker, row) {
  return board[row].every(position => position === marker);
}

function markerWin(board, marker) {
  return (
    INDEXES.some(row => rowWin(board, marker, row)) ||
    INDEXES.some(column => columnWin(board, marker, column)) ||
    diagonalWin(board, marker)
  );
}

function getWinner(game) {
  const {player1, player2, board} = game;
  return markerWin(board, 'X') ? player1 : markerWin(board, 'O') ? player2 : '';
}

const validRowColumn = value => 0 <= value && value <= 2;

app.get('/heartbeat', async (req, res) => {
  res.send('I am alive!');
});

app.get('/games/:userId', async (req, res) => {
  const {userId} = req.params;
  const gamesForUser = Object.values(gameMap).reduce((acc, game) => {
    if (game.player1 === userId || game.player2 === userId) acc[game.id] = game;
    return acc;
  }, {});

  res.set('Content-Type', 'application/json');
  res.send(gamesForUser);
});

app.post('/game', async (req, res) => {
  const {player1, player2} = req.body;
  if (!player1 || !player2)
    return res.status(400).send('player names not supplied');
  const id = Date.now();
  const board = INDEXES.map(row => INDEXES.map(column => ''));
  const game = {id, player1, player2, board};
  gameMap[id] = game;
  res.send(JSON.stringify(game));
});

app.post('/move', async (req, res) => {
  const {gameId, row, column, marker} = req.body;
  const game = gameMap[gameId];

  const msg = !validRowColumn(row)
    ? `invalid row ${row}`
    : !validRowColumn(column)
    ? `invalid column ${column}`
    : marker !== 'X' && marker !== 'O'
    ? `invalid marker "${marker}"`
    : !game
    ? `game ${gameId} not found on server`
    : game.lastMarker && game.lastMarker === marker
    ? `It is not your turn.`
    : null;
  if (msg) return res.status(400).send(msg);

  const position = game.board[row][column];
  if (position) {
    res.status(400).send('position already occupied');
  } else {
    // Make the move and determine whether the game is over..
    game.board[row][column] = marker;
    game.lastMarker = marker;
    const winner = getWinner(game);
    game.winner = winner;
    res.send(winner);

    // Remove any WebSockets that are closing or closed.
    webSockets = webSockets.filter(ws => ws.readyState <= 1);

    // Notify all the connected clients about this move.
    const data = JSON.stringify({gameId, row, column, marker, winner});
    try {
      webSockets.forEach(ws => ws.send(data));
    } catch (e) {
      console.error(e);
    }

    // Remove the game if it is over.
    if (winner) delete gameMap[game.id];
  }
});

app.listen(PORT, () => console.info('listing on port', PORT));
