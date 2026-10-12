/**
 * Zero-dependency local SMTP catcher for development.
 *
 * Why this exists: the SMTP notification provider needs a real SMTP endpoint to
 * send to. Docker/Mailpit may not be available, and pointing development at a
 * real provider risks sending test mail to real inboxes. This speaks just enough
 * SMTP to accept messages and print them, using only Node's `net` module.
 *
 * It is NOT a mail server - it accepts anything, stores nothing, and prints each
 * message to stdout. Development use only.
 *
 * Usage:
 *   node scripts/dev-smtp-catcher.mjs            # listens on 127.0.0.1:1025
 *   node scripts/dev-smtp-catcher.mjs 2525       # custom port
 *
 * Then in apps/backend/.env:
 *   SMTP_HOST=127.0.0.1
 *   SMTP_PORT=1025
 *   SMTP_SECURE=false
 *   SMTP_FROM=no-reply@localhost
 *   (leave SMTP_USER / SMTP_PASSWORD blank)
 */
import net from "node:net"

const PORT = Number(process.argv[2] || 1025)
const HOST = "127.0.0.1"

let messageCount = 0

const server = net.createServer((socket) => {
  let inData = false
  let buffer = ""
  let message = ""

  const send = (line) => {
    socket.write(line + "\r\n")
  }

  send("220 local-smtp-catcher ready")

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8")

    // Keep consuming complete lines.
    let idx
    while ((idx = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)

      if (inData) {
        if (line === ".") {
          inData = false
          messageCount++
          printMessage(message)
          message = ""
          send("250 OK: message accepted")
        } else {
          // Undo SMTP dot-stuffing.
          message += (line.startsWith("..") ? line.slice(1) : line) + "\n"
        }
        continue
      }

      const upper = line.toUpperCase()

      if (upper.startsWith("EHLO")) {
        // Multi-line EHLO reply: every line except the last uses "250-".
        // Sending a bare "250 OK" terminator after capabilities makes strict
        // clients (nodemailer) read it as the response to their NEXT command.
        socket.write(
          "250-localhost\r\n" +
            "250-PIPELINING\r\n" +
            "250-SIZE 10485760\r\n" +
            "250-8BITMIME\r\n" +
            "250-AUTH LOGIN PLAIN\r\n" +
            "250 SMTPUTF8\r\n"
        )
      } else if (upper.startsWith("HELO")) {
        socket.write("250 localhost\r\n")
      } else if (upper.startsWith("AUTH")) {
        send("235 Authentication successful")
      } else if (upper.startsWith("MAIL FROM")) {
        send("250 OK")
      } else if (upper.startsWith("RCPT TO")) {
        send("250 OK")
      } else if (upper.startsWith("DATA")) {
        inData = true
        send("354 End data with <CR><LF>.<CR><LF>")
      } else if (upper.startsWith("RSET")) {
        message = ""
        send("250 OK")
      } else if (upper.startsWith("QUIT")) {
        send("221 Bye")
        socket.end()
      } else if (upper.startsWith("NOOP")) {
        send("250 OK")
      } else {
        send("250 OK")
      }
    }
  })

  socket.on("error", () => {
    // Ignore client disconnects.
  })
})

function printMessage(raw) {
  const lines = raw.split("\n")
  const headerEnd = lines.findIndex((l) => l.trim() === "")
  const headers = lines.slice(0, headerEnd)
  const body = lines.slice(headerEnd + 1).join("\n")

  const get = (name) => {
    const h = headers.find((l) =>
      l.toLowerCase().startsWith(name.toLowerCase() + ":")
    )
    return h ? h.slice(h.indexOf(":") + 1).trim() : "(none)"
  }

  const decodeSubject = (s) => {
    // Decode RFC 2047 encoded-words, the common =?UTF-8?B?...?= form.
    return s.replace(/=\?[^?]+\?[Bb]\?([^?]*)\?=/g, (_, b64) => {
      try {
        return Buffer.from(b64, "base64").toString("utf8")
      } catch {
        return s
      }
    })
  }

  // Pull the plain-text part out of the MIME body when present, so the output
  // is readable rather than a wall of HTML.
  let readable = body
  const textMatch = body.match(
    /Content-Type:\s*text\/plain[^\n]*\n(?:[^\n]*\n)*?\n([\s\S]*?)(?=\n--|\n\.$|$)/
  )
  if (textMatch) {
    readable = textMatch[1]
  }

  console.log("\n" + "=".repeat(72))
  console.log("MESSAGE #" + messageCount)
  console.log("=".repeat(72))
  console.log("From:    " + get("From"))
  console.log("To:      + " + get("To").replace(/^\+ /, ""))
  console.log("Subject: " + decodeSubject(get("Subject")))
  console.log("-".repeat(72))
  console.log(readable.trim().slice(0, 2000))
  console.log("=".repeat(72) + "\n")
}

server.listen(PORT, HOST, () => {
  console.log("Local SMTP catcher listening on " + HOST + ":" + PORT)
  console.log("Point apps/backend/.env at it:")
  console.log("  SMTP_HOST=" + HOST)
  console.log("  SMTP_PORT=" + PORT)
  console.log("  SMTP_SECURE=false")
  console.log("  SMTP_FROM=no-reply@localhost")
  console.log()
  console.log("Waiting for mail... (Ctrl+C to stop)")
})

process.on("SIGINT", () => {
  console.log("\nReceived " + messageCount + " message(s). Bye.")
  server.close(() => process.exit(0))
})
