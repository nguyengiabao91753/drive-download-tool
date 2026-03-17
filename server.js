const { execSync } = require("child_process")
const fs = require("fs")

const chromePath = "/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome"

if (!fs.existsSync(chromePath)) {
  console.log("Chrome not found, installing...")
  execSync("npx puppeteer browsers install chrome", {
    stdio: "inherit",
    env: {
      ...process.env,
      PUPPETEER_CACHE_DIR: "/opt/render/.cache/puppeteer"
    }
  })
  console.log("Chrome installed!")
}

const express = require("express")
const puppeteer = require("puppeteer")
const { PDFDocument } = require("pdf-lib")

const app = express()

app.use(express.json({ limit: "50mb" }))
app.use(express.static("web"))

app.post("/download", async (req, res) => {
  const { url } = req.body
  let logs = []
  let browser

  try {
    logs.push("Launching browser")

    browser = await puppeteer.launch({
      headless: "new",
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
        || "/opt/render/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process"
      ]
    })

    const page = await browser.newPage()
    logs.push("Opening Drive")

    await page.goto(url, { waitUntil: "networkidle2" })

    // Lấy tên tài liệu từ title trang
    const docTitle = await page.title()
    const fileName = docTitle
      .replace(/\s*-\s*Google Drive\s*$/i, "")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "_")
      || "drive"

    logs.push("Document: " + fileName)

    // Kiểm tra file có bị khóa download không (có preview hay không)
    const hasPreview = await page.$(".ndfHFb-c4YZDc-cYSp0e-DARUcf")

    // -------------------------------------------------------
    // CASE 1: File KHÔNG bị khóa → tải trực tiếp
    // -------------------------------------------------------
    if (!hasPreview) {
      logs.push("No preview lock detected, trying direct download...")

      const fileIdMatch = url.match(/[-\w]{25,}/)
      if (!fileIdMatch) throw new Error("Không thể lấy file ID từ URL")

      const fileId = fileIdMatch[0]
      const directUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`

      logs.push("Fetching file directly...")

      const pdfResponse = await page.goto(directUrl, { waitUntil: "networkidle2" })
      const contentType = pdfResponse.headers()["content-type"] || ""

      if (!contentType.includes("pdf")) {
        throw new Error("File này không phải PDF hoặc không thể tải trực tiếp")
      }

      const pdfBuffer = await pdfResponse.buffer()
      await browser.close()

      logs.push("PDF downloaded successfully")
      return res.json({
        success: true,
        log: logs,
        fileName,
        pdf: pdfBuffer.toString("base64")
      })
    }

    // -------------------------------------------------------
    // CASE 2: File BỊ KHÓA → capture từng trang ảnh
    // -------------------------------------------------------
    logs.push("Preview detected, capturing pages...")

    const images = await page.evaluate(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms))

      let pages = [...document.querySelectorAll(".ndfHFb-c4YZDc-cYSp0e-DARUcf")]
      for (let p of pages) {
        p.scrollIntoView()
        await sleep(100)
      }
      await sleep(2000)

      let imgs = [...document.querySelectorAll("img[src^='blob:']")]
      const results = []

      for (let img of imgs) {
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")
        const w = img.naturalWidth || img.width
        const h = img.naturalHeight || img.height
        canvas.width = w
        canvas.height = h
        ctx.drawImage(img, 0, 0, w, h)
        results.push(canvas.toDataURL("image/jpeg", 1))
      }

      return results
    })

    logs.push("Images collected: " + images.length)

    const pdf = await PDFDocument.create()
    for (let dataUrl of images) {
      const base64 = dataUrl.split(",")[1]
      const bytes = Uint8Array.from(Buffer.from(base64, "base64"))
      const img = await pdf.embedJpg(bytes)
      const pagePdf = pdf.addPage([img.width, img.height])
      pagePdf.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height })
    }

    const pdfBytes = await pdf.save()
    await browser.close()

    logs.push("PDF generated")
    res.json({
      success: true,
      log: logs,
      fileName,
      pdf: Buffer.from(pdfBytes).toString("base64")
    })

  } catch (e) {
    if (browser) await browser.close().catch(() => {})
    logs.push("ERROR: " + e.message)
    res.json({ success: false, log: logs })
  }
})

app.listen(3000, () => {
  console.log("Server running http://localhost:3000")
})