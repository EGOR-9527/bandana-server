const express = require("express");
const router = express.Router();
const UserController = require("../controller/userController");

router.get("/events", UserController.getEvents);
router.get("/gallery", UserController.getGallery);
router.get("/video", UserController.getVideo);
router.get("/gallery-filters", UserController.getGalleryFilters);

router.post("/contact", UserController.postContactForm);

module.exports = router;
