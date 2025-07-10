import { Router } from "express";
import {
  getUserMedicalHistory,
  getAnalysisById,
  deleteAnalysis,
} from "../controllers/medicalHistory.controller";

const router = Router();

// Route to get user's medical analysis history
router.get("/user/:userId", getUserMedicalHistory);

// Route to get a specific analysis
router.get("/analysis/:analysisId", getAnalysisById);

// Route to delete an analysis
router.delete("/analysis/:analysisId", deleteAnalysis);

export default router;
