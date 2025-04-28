const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bodyParser = require("body-parser");
const {query} = require("./db"); // PostgreSQL connection
// /////////////////////
const B2 = require('backblaze-b2');

const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID, // your key ID
  applicationKey: process.env.B2_APP_KEY, // your app key
});

async function authorize() {
  await b2.authorize();
}


// /////////////////////


const router = express.Router();
router.use(cors());
router.use(bodyParser.json());
router.use("/public/profileImages", express.static("public/profileImages")); // Serve uploaded images

// // Multer setup
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     cb(null, "public/profileImages");
//   },
//   filename: (req, file, cb) => {
//     cb(null, Date.now() + "_" + file.originalname); // avoid overwrites
//   },
// });
// const upload = multer({ storage });


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


// const { b2, authorize } = require('./b2');

// Multer memory storage instead of disk
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.put("/profile/update-image/:userId", upload.single("profileImage"), async (req, res) => {
  const userId = req.params.userId;

  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  try {
    await authorize(); // Make sure B2 client is authorized

    const uploadUrlResponse = await b2.getUploadUrl({ bucketId: process.env.B2_BUCKET_ID });
    const uploadUrl = uploadUrlResponse.data.uploadUrl;
    const uploadAuthToken = uploadUrlResponse.data.authorizationToken;

    const fileName = `profileImages/${Date.now()}_${req.file.originalname}`;
    const fileBuffer = req.file.buffer;
    const contentType = req.file.mimetype;

    const uploadResponse = await b2.uploadFile({
      uploadUrl,
      uploadAuthToken,
      fileName,
      data: fileBuffer,
      contentType,
    });

    const imageUrl = `${process.env.B2_BUCKET_URL}/${fileName}`; // construct your public URL

    // Save image URL into PostgreSQL
    const result = await query(
      "UPDATE users SET profile_image = $1 WHERE id = $2 RETURNING *",
      [imageUrl, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile image updated successfully", user: result.rows[0] });
  } catch (err) {
    console.error(err.response?.data || err);
    res.status(500).json({ message: "Failed to upload profile image" });
  }
});

// // 🟠 Upload profile image
// router.put("/profile/update-image/:userId", upload.single("profileImage"), async (req, res) => {
//   const userId = req.params.userId;

//   if (!req.file) {
//     return res.status(400).json({ message: "No file uploaded" });
//   }

//   const imagePath = `/profileImages/${req.file.filename}`;

//   try {
//     const result = await query(
//       "UPDATE users SET profile_image = $1 WHERE id = $2 RETURNING *",
//       [imagePath, userId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ message: "User not found" });
//     }

//     res.json({ message: "Profile image updated successfully", user: result.rows[0] });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: "Failed to update profile image" });
//   }
// });

module.exports = router;