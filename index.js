const express = require("express");
const axios = require('axios');
const fs = require("fs");
const multer = require("multer");
const path = require("path");
const cors =require("cors")
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const { v4: uuidv4 } = require('uuid');  // UUID generation for unique identifiers
const bodyParser = require('body-parser');  // Parse incoming request bodies

dotenv.config();


// ////////////////
// const ordersRoutes = require("./jsFiles/orders");
const cartRoutes = require("./jsFiles/cart");
// const wishlistRoutes = require("./jsFiles/wishlist");
const signUpRoutes = require("./jsFiles/signUp");
const signInRoutes = require("./jsFiles/signIn");
// const editProfileRoutes = require("./jsFiles/editProfile");
// const editProfilePictureRoutes = require("./jsFiles/editProfilePicture");
const formUploadRoutes = require("./jsFiles/formUpload");
const productsRoutes = require("./jsFiles/products");
// const passwardResetRoutes = require("./jsFiles/passwardReset");
// const logsRoutes = require("./jsFiles/logs");


const JWT_SECRET = process.env.JWT_SECRET 


const app = express();

app.use(bodyParser.json({limit: "50mb"}));  // Support for JSON-encoded bodies
app.use(bodyParser.urlencoded({limit: "50mb", extended: true}));
app.use(cors());
app.use(express.json()); // Middleware to parse JSON requests
// app.use("upload", express.static("upload"))

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: 'Access token is required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user; // Attach the decoded user data to the request
    next();
  });
};

app.use(express.urlencoded({extended:true}))

app.use(cors({
    origin:[
      "http://localhost:3000",
      "https://apaxt.netlify.app"
    ],
    methods:"GET, POST, PUT, DELETE",
    allowedHeaders:"Content-Type, Authorization" // Fixed typo: "Athorization" -> "Authorization"
}))

// app.use("/", ordersRoutes);
app.use("/", cartRoutes);
// app.use("/", wishlistRoutes);
app.use("/", signUpRoutes);
app.use("/", signInRoutes);
// app.use("/", editProfileRoutes);
// app.use("/", editProfilePictureRoutes);
app.use("/", formUploadRoutes);
app.use("/", productsRoutes);
// app.use("/", passwardResetRoutes);
// app.use("/", logsRoutes);




app.use("/public/profileImages", express.static(path.join(__dirname,"public","profileImages"))); // Serve profile images




// ///////////////////////////////////////////////////////////////////////////////////////////
// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))


