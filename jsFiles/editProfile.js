const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bodyParser = require("body-parser");
const {query} = require("./db"); // PostgreSQL connection


const router = express.Router();
router.use(cors());
router.use(bodyParser.json());
router.use("/public/profileImages", express.static("public/profileImages")); // Serve uploaded images

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "public/profileImages");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "_" + file.originalname); // avoid overwrites
  },
});
const upload = multer({ storage });


// 🟢 Fetch user by ID
router.get("/profile/:id", async (req, res) => {
  const { userId } = req.query;

  try {
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const result = await query("SELECT * FROM users WHERE id = $1", [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error retrieving user" });
  }
});





// 🟡 Update profile info
router.put("/profile/update", async (req, res) => {
  const { id, ...fields } = req.body;

  try {
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClause = keys.map((key, idx) => `${key} = $${idx + 2}`).join(", ");

    const result = await query(
      `UPDATE users SET ${setClause} WHERE id = $1 RETURNING *`,
      [id, ...values]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile updated successfully", user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update profile" });
  }
});


// 🟠 Upload profile image
router.put("/profile/update-image/:userId", upload.single("profileImage"), async (req, res) => {
  const userId = req.params.userId;

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const imagePath = `/profileImages/${req.file.filename}`;

  try {
    const result = await query(
      "UPDATE users SET profile_image = $1 WHERE id = $2 RETURNING *",
      [imagePath, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile image updated successfully", user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to update profile image" });
  }
});

module.exports = router;