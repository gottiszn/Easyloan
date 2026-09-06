const express = require("express"); 
const mysql = require("mysql2");
const app = express(); 
const PORT = process.env.PORT || 8080;

const http = require("http");
const { Server } = require("socket.io");

const server = http.createServer(app);
const io = new Server(server);

// Middleware 
app.use(express.json()); app.use(express.urlencoded({ extended: true })); app.use(express.static("public"));

// MySQL Connection 
const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT || 3306
});
server.listen(PORT, () => {
  console.log(`Easyloan server running on port ${PORT}`)
});


db.connect((err) => 
    { if (err) { 
        console.error("Database connection failed:", err.message); 
        return; } console.log("Connected to MySQL database!"); });


// Registration Route 
app.post("/register", (req, res) => { const { name, email, password, phone } = req.body;

if (!name || !email || !password) { return res.status(400).json({ message: "Please provide name, email, and password" }); }

const userPhone = phone || null;
const sql = "INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)";
db.query(sql, [name, email, password], (err, result) => {
    if (err) { 
        console.error("Database query error:", err.message); 
        return res.status(500).json({ message: "Registration failed" }); 
    } 
    res.json({ message: "Registration successful!", userId: result.insertId }); }); });
// Login Route 
app.post("/login", (req, res) => { const { email, password } = req.body;
if (!email || !password) { return res.status(400).json({ message: "Please enter email and password" }); }
const cleanEmail = String(email).trim(); const cleanPassword = String(password).trim(); const sql = "SELECT * FROM users WHERE LOWER(email) = LOWER(?)";
db.query(sql, [cleanEmail], (err, results) => { if (err) { console.error("Login Database error:", err.message); return res.status(500).json({ message: "Server error" }); }
if (results.length === 0) {
  return res.status(401).json({ message: "Invalid email or password" });
}

const user = results[0];

// Fixed: check user.password instead of user.password_hash
if (user.password !== cleanPassword) {
  return res.status(401).json({ message: "Invalid email or password" });
}

res.json({
  message: "Login successful!",
  user: {
    id: user.id,
    full_name: user.full_name,
    email: user.email
  }
});
}); });
// 1. Get All Loans for Admin 
app.get("/admin/loans", (req, res) => { 
    const sql = "SELECT * FROM loans ORDER BY created_at DESC"; 
    db.query(sql, (err, results) => { 
        if (err) { 
            console.error("Admin fetch error:", err.message); 
            return res.status(500).json({ message: "Failed to fetch loans." }); 
        } 
        res.json({ loans: results }); }); });


const path = require("path");
const multer = require("multer");


// 1. Configure Multer Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/uploads");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

// 2. Initialize Upload Middleware
const upload = multer({ storage: storage });

// 3. Serve Static Uploads
app.use("/uploads", express.static("public/uploads"));

        // Submit Loan Application Route 
app.post("/apply-loan", upload.single("id_image"), (req, res) => { 
  const { user_name, phone, token_number, secret_code } = req.body; 
  const image_path = req.file ? `/uploads/${req.file.filename}` : null;

const sql = "INSERT INTO loans (user_name, phone, token_number, secret_code, image_path, status) VALUES (?, ?, ?, ?, ?, 'Pending')";

db.query(sql, [user_name, phone, token_number, secret_code, image_path], (err, result) => { 
  if (err) { 
    console.error("SQL INSERT ERROR:", err); 
    return res.status(500).json({ message: "Database error: " + err.message }); 
  }
const smsMessage = `Hello ${user_name}, your EasyLoan application has been received! Your Token Number is ${token_number}. Keep this token to check your account status.`;
console.log("SMS Notification:", smsMessage);

return res.status(200).json({
  message: "Loan application submitted successfully!",
  loanId: result.insertId,
  token_number: token_number
});
}); });
        
// 2. Update Loan Status (Approve / Reject) 
app.patch("/admin/loans/:id/status", (req, res) => { 
    const loanId = req.params.id; 
    const { status } = req.body; 

    // 'Approved' or 'Rejected'
if (!["Approved", "Rejected"].includes(status)) { 
    return res.status(400).json({ message: "Invalid status status value." }); 
}
const sql = "UPDATE loans SET status = ? WHERE id = ?"; 
db.query(sql, [status, loanId], (err, result) => { 
    if (err) { 
        console.error("Status update error:", err.message); 
        return res.status(500).json({ message: "Failed to update status." }); 
    } 
    res.json({ message: `Loan #${loanId} marked as ${status}` }); }); });

// Get Loan History by Phone Number
app.get("/loan-history/:phone", (req, res) => {
  const { phone } = req.params;
  const sql = "SELECT token_number, status FROM loans WHERE phone = ?";

  db.query(sql, [phone], (err, results) => {
    if (err) {
      console.error("History fetch error:", err.message);
      return res.status(500).json({ message: "Failed to fetch loan history." });
    }
    res.json({ loans: results });
  });
});


    // User API: Get Dashboard & Account Balance 
    app.get("/api/user/dashboard/:token", (req, res) => { 
        const token = req.params.token; 
        const sql = "SELECT user_name, phone, token_number, loan_amount, status FROM loans WHERE token_number = ?";

        db.query(sql, [token], (err, results) => { 
            if (err) return res.status(500).json({ message: "Database error." }); 
            if (results.length === 0) return res.status(404).json({ message: "Account not found." });

        const loan = results[0];

// Balance is accessible only if Approved
const balance = loan.status === "Approved" ? (loan.loan_amount || 5000) : 0;

res.json({
  user_name: loan.user_name,
  token_number: loan.token_number,
  status: loan.status,
  balance: balance
});
}); });
// User API: Process Withdrawal 
app.post("/api/user/withdraw", (req, res) => { const { token_number, amount, bank_name, account_number } = req.body;
const checkSql = "SELECT status, loan_amount FROM loans WHERE token_number = ?"; db.query(checkSql, [token_number], (err, results) => { if (err || results.length === 0) return res.status(400).json({ message: "Invalid request." });
if (results[0].status !== "Approved") {
  return res.status(403).json({ message: "Withdrawal denied. Loan is not approved." });
}

const updateSql = "UPDATE loans SET status = 'Withdrawal Processing' WHERE token_number = ?";
db.query(updateSql, [token_number], (err) => {
  if (err) return res.status(500).json({ message: "Withdrawal failed." });
  res.json({ message: `Withdrawal request of GHS ${amount} submitted successfully!` });
});
}); 

});

const axios = require("axios");
// Reusable SMS Helper Function (Using Arkesel / Hubtel API format) 
async function sendSMS(phone, message) { 
    try { 
        const apiKey = "YOUR_ARKESEL_API_KEY"; 
        // Replace with your actual API key 
        const senderId = "EasyLoan";
// Example call using Arkesel's SMS endpoint
const url = `https://sms.arkesel.com/sms/api?action=send-sms&api_key=${apiKey}&to=${phone}&from=${senderId}&sms=${encodeURIComponent(message)}`;

await axios.get(url);
console.log(`[SMS SUCCESS] Message sent to ${phone}`);
} catch (err) { console.error("[SMS ERROR] Failed to send SMS:", err.message); } }

// Admin Login API
app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  
  // Replace these credentials with your preferred admin login
  if (username === "gotti.szn" && password === "!@Password12345") {
    res.json({ success: true, token: "easyloan-admin-secret-token" });
  } else {
    res.status(401).json({ success: false, message: "Invalid admin credentials!" });
  }
});



// Start Server 
app.listen(PORT, () => { console.log(`EasyLoan server running at http://localhost:${PORT}`); });


 
// --- Socket.io Real-Time Chat ---
io.on("connection", (socket) => {
  socket.on("join_room", (token) => {
    socket.join(token);
  });

  socket.on("send_message", (data) => {
    io.to(data.token).emit("receive_message", data);
  });
});

// Replace app.listen with server.listen
server.listen(3000, () => {
  console.log("Server running with Chat on http://localhost:3000");
});


// Fire SMS dispatch asynchronously
sendSMS(phone, smsMessage);

res.json({ message: "Loan application submitted successfully!", token_number });

// 2. Fetch Transaction & Loan History Route 
app.get("/loan-history/:phone", (req, res) => { const userPhone = req.params.phone;
const sql = "SELECT id, user_name, token_number, status, created_at FROM loans WHERE phone = ? ORDER BY created_at DESC";
db.query(sql, [userPhone], (err, results) => { if (err) { console.error("Fetch history error:", err.message); return res.status(500).json({ message: "Failed to fetch transaction history." }); }
res.json({ history: results });
}); });