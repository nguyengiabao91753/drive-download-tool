const express = require("express")
const puppeteer = require("puppeteer")
const { PDFDocument } = require("pdf-lib")

const app = express()

app.use(express.json({limit:"50mb"}))
app.use(express.static("web"))

app.post("/download", async (req,res)=>{

 const {url} = req.body

 let logs=[]

 try{

 logs.push("Launching browser")

 const browser = await puppeteer.launch({
  headless: "new",
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
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

 await page.goto(url,{waitUntil:"networkidle2"})

 await page.waitForSelector(".ndfHFb-c4YZDc-cYSp0e-DARUcf",{timeout:15000})

 logs.push("Preview detected")

 const images = await page.evaluate(async ()=>{

  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))

  let pages=[...document.querySelectorAll(".ndfHFb-c4YZDc-cYSp0e-DARUcf")]

  for(let p of pages){
   p.scrollIntoView()
   await sleep(100)
  }

  await sleep(2000)

  let imgs=[...document.querySelectorAll("img[src^='blob:']")]

  const results=[]

  for(let img of imgs){

   const canvas=document.createElement("canvas")
   const ctx=canvas.getContext("2d")

   const w=img.naturalWidth||img.width
   const h=img.naturalHeight||img.height

   canvas.width=w
   canvas.height=h

   ctx.drawImage(img,0,0,w,h)

   results.push(canvas.toDataURL("image/jpeg",1))

  }

  return results

 })

 logs.push("Images collected: "+images.length)

 const pdf = await PDFDocument.create()

 for(let dataUrl of images){

  const base64=dataUrl.split(",")[1]

  const bytes=Uint8Array.from(Buffer.from(base64,"base64"))

  const img=await pdf.embedJpg(bytes)

  const pagePdf=pdf.addPage([img.width,img.height])

  pagePdf.drawImage(img,{
   x:0,
   y:0,
   width:img.width,
   height:img.height
  })

 }

 const pdfBytes = await pdf.save()

 await browser.close()

 logs.push("PDF generated")

 res.json({
  success:true,
  log:logs,
  pdf:Buffer.from(pdfBytes).toString("base64")
 })

 }catch(e){

 logs.push("ERROR: "+e.message)

 res.json({
  success:false,
  log:logs
 })

 }

})

app.listen(3000,()=>{
 console.log("Server running http://localhost:3000")
})