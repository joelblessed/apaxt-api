const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('./db'); // PostgreSQL connection
const router = express.Router();

// Configuration
const PROFILE_IMAGES_DIR = path.join(__dirname, "../public/profileImages");

// Ensure directory exists
if (!fs.existsSync(PROFILE_IMAGES_DIR)) {
  fs.mkdirSync(PROFILE_IMAGES_DIR, { recursive: true });
}

// Serve profile images statically
router.use('/profileImages', express.static(PROFILE_IMAGES_DIR));

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, PROFILE_IMAGES_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'profile-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and GIF images are allowed'));
    }
  }
});

// Update profile image endpoint
router.put('/users/:userId/profile-image', 
  upload.single('profileImage'), 
  async (req, res) => {
    const transaction = await query('BEGIN'); // Start transaction
    let oldImagePath = null;

    try {
      const { userId } = req.params;

      // Validate user ID
      if (!userId || isNaN(parseInt(userId))) {
        await query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID'
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        await query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'No image file provided'
        });
      }

      // Get current user data with row locking
      const userResult = await query(
        'SELECT profile_image FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );

      if (userResult.rows.length === 0) {
        await query('ROLLBACK');
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const currentProfileImage = userResult.rows[0].profile_image;

      // Delete old profile image if it exists and isn't the default
      if (currentProfileImage && !currentProfileImage.includes('default-avatar')) {
        oldImagePath = path.join(PROFILE_IMAGES_DIR, path.basename(currentProfileImage));
        
        // Record in history table before deleting
        await query(
          'INSERT INTO profile_image_history (user_id, image_path) VALUES ($1, $2)',
          [userId, currentProfileImage]
        );
      }

      // Update user with new image path
      const newImagePath = `/profileImages/${req.file.filename}`;
      
      const updatedUser = await query(
        `UPDATE users 
         SET profile_image = $1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING id, username, email, profile_image, full_name, phone_number, address, gender, country`,
        [newImagePath, userId]
      );

      // Commit transaction
      await query('COMMIT');

      // Delete old file after successful commit
      if (oldImagePath && fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }

      res.json({
        success: true,
        message: 'Profile image updated successfully',
        data: {
          profileImage: newImagePath,
          user: updatedUser.rows[0]
        }
      });

    } catch (err) {
      await query('ROLLBACK');
      
      // Clean up uploaded file if error occurred
      if (req.file) {
        const filePath = path.join(PROFILE_IMAGES_DIR, req.file.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      console.error('Error updating profile image:', err);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
);

// Get user endpoint
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { rows } = await query(
      `SELECT id, username, email, profile_image, full_name, 
       phone_number, address, gender, country 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });

  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;



// const express = require('express');
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');
// const cors = require('cors');
// const pool = require('./db'); // PostgreSQL connection pool
// const router = express.Router();

// const PROFILE_IMAGES_DIR = path.join(__dirname, "../public/profileImages");
// if (!fs.existsSync(PROFILE_IMAGES_DIR)) fs.mkdirSync(PROFILE_IMAGES_DIR, { recursive: true });

// // Middleware
// router.use(cors());
// router.use(express.json());
// router.use('/profileImages', express.static(PROFILE_IMAGES_DIR));

// // Multer Config
// const storage = multer.diskStorage({
//   destination: (_, cb) => cb(null, PROFILE_IMAGES_DIR),
//   filename: (_, file, cb) => {
//     const unique = `profile-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
//     cb(null, unique);
//   }
// });
// const upload = multer({
//   storage,
//   limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
//   fileFilter: (_, file, cb) => {
//     const allowed = ['image/jpeg', 'image/png', 'image/gif'];
//     cb(null, allowed.includes(file.mimetype));
//   }
// });

// // PUT: Update Profile Image
// router.put('/api/users/:userId/profile-image', upload.single('profileImage'), async (req, res) => {
//   const { userId } = req.params;

//   if (!req.file) {
//     return res.status(400).json({ success: false, message: 'No image file provided' });
//   }

//   try {
//     const { rows } = await pool.query("SELECT profile_image FROM users WHERE id = $1", [userId]);
//     if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

//     const oldImagePath = rows[0].profile_image;
//     const newImagePath = `/profileImages/${req.file.filename}`;

//     // Remove old image if not default
//     if (oldImagePath && !oldImagePath.includes('default-avatar')) {
//       const localPath = path.join(PROFILE_IMAGES_DIR, path.basename(oldImagePath));
//       if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
//     }

//     // Update user
//     const result = await pool.query(
//       "UPDATE users SET profile_image = $1 WHERE id = $2 RETURNING *",
//       [newImagePath, userId]
//     );

//     res.json({
//       success: true,
//       message: 'Profile image updated successfully',
//       data: {
//         profileImage: newImagePath,
//         user: result.rows[0]
//       }
//     });

//   } catch (err) {
//     console.error('Error updating profile image:', err);
//     res.status(500).json({ success: false, message: 'Internal server error', error: err.message });
//   }
// });

// // GET: Fetch Single User
// router.get('/api/users/:userId', async (req, res) => {
//   const { userId } = req.params;

//   try {
//     const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
//     if (result.rows.length === 0) {
//       return res.status(404).json({ success: false, message: 'User not found' });
//     }

//     res.json({ success: true, data: result.rows[0] });

//   } catch (err) {
//     console.error('Error fetching user:', err);
//     res.status(500).json({ success: false, message: 'Internal server error' });
//   }
// });

// module.exports = router;