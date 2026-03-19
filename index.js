const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const path = require("path")

const { loadQuestions, getRandomQuestion } = require("./data/questionsLoader")

const app = express()
const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: "*" }
})

const PORT = process.env.PORT || 3007

app.use(express.static(path.join(__dirname, "public")))

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"))
})

let players = []
let teams = []
let currentTeamIndex = 0
let currentAnswers = {}
let timer = 60
let interval = null
let currentQuestion = null
let questionCount = 0
let gameStarted = false
let lobbyCode = createLobbyCode()

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

function createLobbyCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
}

function getLobbyPayload() {
  return {
    code: lobbyCode,
    players,
    canStart: players.length >= 2 && players.length % 2 === 0,
    gameStarted
  }
}

function resetRoundState() {
  currentTeamIndex = 0
  currentAnswers = {}
  timer = 60
  questionCount = 0
  currentQuestion = null

  if (interval) {
    clearInterval(interval)
    interval = null
  }
}

function resetLobby() {
  players = []
  teams = []
  gameStarted = false
  lobbyCode = createLobbyCode()
  resetRoundState()
  io.emit("lobby_update", getLobbyPayload())
}

function emitLobbyUpdate(target = io) {
  target.emit("lobby_update", getLobbyPayload())
}

function emitGameState() {
  const activeTeam = teams[currentTeamIndex] || null

  io.emit("turn_update", {
    activeTeam,
    teamNumber: activeTeam ? currentTeamIndex + 1 : null,
    totalTeams: teams.length,
    questionCount
  })
}

loadQuestions()

setInterval(() => {
  loadQuestions()
}, 60 * 60 * 1000)

io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id)

  emitLobbyUpdate(socket)

  socket.on("join_game", ({ name, lobbyCode: submittedCode }) => {
    const cleanName = String(name || "").trim()
    const cleanCode = String(submittedCode || "").trim().toUpperCase()

    if (gameStarted) {
      socket.emit("join_error", "La partida ya comenzó. Espera a la siguiente ronda.")
      return
    }

    if (!cleanName) {
      socket.emit("join_error", "Escribe tu nombre para entrar al lobby.")
      return
    }

    if (cleanCode !== lobbyCode) {
      socket.emit("join_error", "El código de lobby no coincide.")
      return
    }

    const alreadyJoined = players.some((player) => player.id === socket.id)

    if (!alreadyJoined) {
      players.push({
        id: socket.id,
        name: cleanName
      })
    } else {
      players = players.map((player) => (
        player.id === socket.id
          ? { ...player, name: cleanName }
          : player
      ))
    }

    socket.emit("join_success", { name: cleanName, lobbyCode })
    emitLobbyUpdate()
  })

  socket.on("start_game", () => {
    if (gameStarted || players.length < 2 || players.length % 2 !== 0) {
      socket.emit("game_error", "Se necesitan al menos 2 jugadores y un número par para comenzar.")
      return
    }

    players.sort(() => Math.random() - 0.5)

    teams = []
    for (let i = 0; i < players.length; i += 2) {
      teams.push({
        id: "team_" + i,
        players: [players[i], players[i + 1]],
        score: 0,
        streak: 0
      })
    }

    gameStarted = true
    resetRoundState()

    io.emit("game_started", teams)
    emitLobbyUpdate()

    startTurn()
  })

  socket.on("submit_answer", (answer) => {
    if (!gameStarted) {
      return
    }

    currentAnswers[socket.id] = answer

    const team = teams[currentTeamIndex]
    if (!team) return

    const ids = team.players.map((player) => player.id)

    if (ids.every((id) => currentAnswers[id])) {
      clearInterval(interval)
      interval = null

      const [a, b] = ids.map((id) => currentAnswers[id])

      let points = 2
      let match = false

      if (normalize(a) === normalize(b)) {
        points += 3
        match = true
        team.streak++

        if (team.streak === 3) {
          points += 2
          team.streak = 0
        }
      } else {
        team.streak = 0
      }

      if (questionCount === 6) {
        points *= 2
      }

      team.score += points

      io.emit("answer_result", {
        answers: [a, b],
        match,
        points,
        total: team.score,
        team
      })
    }
  })

  socket.on("next_question", () => {
    if (!gameStarted) {
      return
    }

    currentAnswers = {}
    sendQuestion()
  })

  socket.on("reset_lobby", () => {
    resetLobby()
  })

  socket.on("disconnect", () => {
    players = players.filter((player) => player.id !== socket.id)

    if (!players.length && !gameStarted) {
      lobbyCode = createLobbyCode()
    }

    emitLobbyUpdate()
  })
})

function startTurn() {
  timer = 60
  questionCount = 0
  sendQuestion()

  interval = setInterval(() => {
    timer--
    io.emit("timer", timer)

    if (timer <= 0) {
      clearInterval(interval)
      interval = null
      currentTeamIndex++

      if (currentTeamIndex < teams.length) {
        startTurn()
      } else {
        io.emit("game_over", teams)
        gameStarted = false
        emitLobbyUpdate()
      }
    }
  }, 1000)
}

function sendQuestion() {
  questionCount++
  currentQuestion = getRandomQuestion()

  io.emit("new_question", {
    question: currentQuestion,
    number: questionCount
  })

  emitGameState()
}

server.listen(PORT, () => {
  console.log("Running on port " + PORT)
})
