const express = require("express");
const router = express.Router();
const UserController = require("../controller/userController");

router.get("/events", UserController.getEvents);
router.get("/gallery", UserController.getGallery);
router.get("/video", UserController.getVideo);
router.get("/gallery/filters", UserController.getGalleryFilters);
router.get("/teams", UserController.getTeams);

router.post("/contact", UserController.postContactForm);

router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "API работает",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || "development",
  });
});

module.exports = router;
