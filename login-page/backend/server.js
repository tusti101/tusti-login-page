const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

// Helper function to generate JWT tokens
const generateToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "1h" });
};

// ------------------- Register User -------------------
app.post("/register", async (req, res) => {
    const { email, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            "INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email",
            [email, hashedPassword]
        );

        res.json({ message: "User registered successfully", user: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: "Error registering user" });
    }
});

// ------------------- Login User with Session Handling -------------------
app.post("/login", async (req, res) => {
    const { email, password, lockSession } = req.body;

    try {
        const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (userResult.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

        const user = userResult.rows[0];
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

        // Check if the user already has an active session
        const activeSession = await pool.query(
            "SELECT * FROM sessions WHERE user_id = $1 AND expires_at > NOW()",
            [user.id]
        );

        if (activeSession.rows.length > 0) {
            const session = activeSession.rows[0];

            if (session.locked) {
                return res.status(403).json({
                    error: "This session is locked. You cannot log in from another device.",
                });
            }

            return res.status(409).json({
                error: "You are already logged in elsewhere. Would you like to logout from the other session and log in here?",
                session_id: session.id,
            });
        }

        // Generate a new session
        const sessionToken = generateToken(user.id);
        await pool.query(
            "INSERT INTO sessions (user_id, session_token, expires_at, locked) VALUES ($1, $2, NOW() + INTERVAL '1 hour', $3)",
            [user.id, sessionToken, lockSession]
        );

        res.json({ message: "Login successful", token: sessionToken });
    } catch (error) {
        res.status(500).json({ error: "Error logging in" });
    }
});

// ------------------- Logout Specific Session -------------------
app.post("/logout", async (req, res) => {
    const { session_id } = req.body;

    try {
        await pool.query("DELETE FROM sessions WHERE id = $1", [session_id]);
        res.json({ message: "Session logged out successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error logging out session" });
    }
});

// ------------------- Logout All Sessions (Except Current) -------------------
app.post("/logout-all", async (req, res) => {
    const { user_id, current_session_token } = req.body;

    try {
        await pool.query("DELETE FROM sessions WHERE user_id = $1 AND session_token != $2", [
            user_id,
            current_session_token,
        ]);
        res.json({ message: "All other sessions logged out successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error logging out other sessions" });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
