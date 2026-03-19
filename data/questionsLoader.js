const axios = require("axios")

const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vS146SVQHro9nxHxEPM4KadlClO6fIVCtiXwbwY3vurRt-KcrVFhY3hFHgzBPkmyG0QiWXVadWaexuM/pub?output=csv"

let questions = []

async function loadQuestions() {
  try {
    const res = await axios.get(SHEET_URL)

    const rows = res.data.split("\n")

    questions = rows
      .slice(1) // quitar encabezado
      .map(r => r.replace(/"/g, "").trim())
      .filter(r => r.length > 0)

    console.log("Preguntas cargadas:", questions.length)

  } catch (err) {
    console.error("Error cargando preguntas:", err.message)
  }
}

function getRandomQuestion() {
  if (questions.length === 0) return "Cargando preguntas..."
  return questions[Math.floor(Math.random() * questions.length)]
}

module.exports = {
  loadQuestions,
  getRandomQuestion
}
