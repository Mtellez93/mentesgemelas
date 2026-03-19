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

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, "public")))

// ✅ Ruta base (soluciona "Cannot GET /")
app.get("/", (req, res) => {
  res.send(`
    <h1>Mentes Gemelas 🎮</h1>
    <p><a href="/host.html">Ir a Host (TV)</a></p>
    <p><a href="/join.html">Unirse al juego</a></p>
  `)
})

// Estado del juego
let players = []
let teams = []
let currentTeamIndex = 0
let currentAnswers = {}
let timer = 60
let interval = null
let currentQuestion = null
let questionCount = 0

// Normalizar texto (para comparar respuestas)
function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

// Cargar preguntas al iniciar
loadQuestions()

// 🔁 Auto-refresh cada 60 minutos
setInterval(() => {
  loadQuestions()
}, 60 * 60 * 1000)

// SOCKET.IO
io.on("connection", (socket) => {

  console.log("Usuario conectado:", socket.id)

  socket.on("join_game", (name) => {
    players.push({
      id: socket.id,
      name
    })

    io.emit("lobby_update", players)
  })

  socket.on("start_game", () => {
    // Mezclar jugadores
    players.sort(() => Math.random() - 0.5)

    teams = []
    for (let i = 0; i < players.length; i += 2) {
      if (!players[i + 1]) continue

      teams.push({
        id: "team_" + i,
        players: [players[i], players[i + 1]],
        score: 0,
        streak: 0
      })
    }

    currentTeamIndex = 0

    io.emit("game_started", teams)

    startTurn()
  })

  socket.on("submit_answer", (answer) => {
    currentAnswers[socket.id] = answer

    const team = teams[currentTeamIndex]
    if (!team) return

    const ids = team.players.map(p => p.id)

    if (ids.every(id => currentAnswers[id])) {
      clearInterval(interval)

      let [a, b] = ids.map(id => currentAnswers[id])

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

      // Pregunta 6 = doble puntos
      if (questionCount === 6) {
        points *= 2
      }

      team.score += points

      io.emit("answer_result", {
        answers: [a, b],
        match,
        points,
        total: team.score
      })
    }
  })

  socket.on("next_question", () => {
    currentAnswers = {}
    sendQuestion()
  })

  socket.on("disconnect", () => {
    players = players.filter(p => p.id !== socket.id)
    io.emit("lobby_update", players)
  })

})

// Lógica de turnos
function startTurn() {
  timer = 60
  questionCount = 0
  sendQuestion()

  interval = setInterval(() => {
    timer--
    io.emit("timer", timer)

    if (timer <= 0) {
      clearInterval(interval)
      currentTeamIndex++

      if (currentTeamIndex < teams.length) {
        startTurn()
      } else {
        io.emit("game_over", teams)
      }
    }
  }, 1000)
}

// Enviar nueva pregunta
function sendQuestion() {
  questionCount++
  currentQuestion = getRandomQuestion()

  io.emit("new_question", {
    question: currentQuestion,
    number: questionCount
  })
}

// Iniciar servidor
server.listen(PORT, () => {
  console.log("Running on port " + PORT)
})
