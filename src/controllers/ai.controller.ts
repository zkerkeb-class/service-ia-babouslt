import { Request, Response } from "express";
import OpenAI from "openai";
import {
  replaceTemplateVariables,
  validateTemplateData,
  PromptData,
} from "../utils/promptTemplates";
import fs from "fs";
import path from "path";
import MedicalAnalysis from "../models/medicalAnalysis.model";

// Extend Request type to include uploaded file
interface RequestWithFile extends Request {
  file?: Express.Multer.File;
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// Fixed medical template
const MEDICAL_TEMPLATE = `Tu es un assistant médical spécialisé dans l'analyse préliminaire des symptômes. À partir des informations patient ci-dessous, donne uniquement une liste de diagnostics médicaux possibles (2 à 4 maximum). Pour chaque diagnostic, fournis :
- Titre du diagnostic
- Symptômes
- Cause
- Traitement
- Tests

Formate chaque diagnostic exactement ainsi :
🔹 1. [Titre du diagnostic]
Symptômes : ...
Cause : ...
Traitement : ...
Tests : ...

🔹 2. [Titre du diagnostic]
Symptômes : ...
Cause : ...
Traitement : ...
Tests : ...

N'inclus rien d'autre : pas de conseils, pas d'avertissements, pas de texte introductif ou conclusif. Réponds uniquement avec la liste formatée.

INFORMATIONS PATIENT :
- ID utilisateur : {{userId}}
- Âge : {{age}} ans
- Sexe : {{sexe}}
- Taille : {{taille}} cm
- Poids : {{poids}} kg
- Symptômes décrits : {{symptomes}}
- Niveau de douleur (1-10) : {{niveauDouleur}}
- Localisation de la douleur : {{localisationDouleur}}
`;

const REQUIRED_FIELDS = [
  "userId",
  "age",
  "sexe",
  "taille",
  "poids",
  "symptomes",
  "niveauDouleur",
  "localisationDouleur",
];

export const generateMedicalAnalysis = async (
  req: Request,
  res: Response
): Promise<void> => {
  console.log(req.body);
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({
        success: false,
        message:
          "OpenAI API key not configured. Please configure OPENAI_API_KEY in your .env file",
      });
      return;
    }

    const {
      userId,
      age,
      sexe,
      taille,
      poids,
      symptomes,
      niveauDouleur,
      localisationDouleur,
    } = req.body;

    // Validate required data
    const providedData = {
      userId,
      age,
      sexe,
      taille,
      poids,
      symptomes,
      niveauDouleur,
      localisationDouleur,
    };
    const missingFields = REQUIRED_FIELDS.filter(
      (field) =>
        !providedData[field] || String(providedData[field]).trim() === ""
    );

    if (missingFields.length > 0) {
      res.status(400).json({
        success: false,
        message: "Incomplete data",
        missingFields: missingFields,
      });
      return;
    }

    // Replace variables in template
    const finalPrompt = replaceTemplateVariables(
      MEDICAL_TEMPLATE,
      providedData
    );

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a medical assistant specialized in preliminary symptom analysis. Analyze the provided human body information, focusing on the pain location.",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                finalPrompt +
                `\n\nLocalisation de la douleur : ${localisationDouleur}`,
            },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0]?.message?.content;

    // Post-traitement pour formatage et réordonnancement style "🔹 n. ..."
    function formatAndOrderAIResponse(raw: string | undefined): string {
      if (!raw) return "";
      // Découpe par diagnostic (1. ... 2. ... etc)
      const regex = /\n?\d+\.\s+/g;
      const parts = raw.split(regex).filter(Boolean);
      let formatted = "";
      parts.forEach((part, idx) => {
        // Cherche le titre (jusqu'à la première ligne ou deux points)
        const lines = part.split("\n").filter((l) => l.trim() !== "");
        let title = lines[0];
        let body = lines.slice(1).join("\n");
        if (!title.match(/\w/)) title = `Diagnostic ${idx + 1}`;

        // Recherche des sections
        const symptomesMatch = body.match(/Sympt[oô]mes?\s*[:：][^\n]*/i);
        const causeMatch = body.match(/Cause\s*[:：][^\n]*/i);
        const traitementMatch = body.match(/Traitement\s*[:：][^\n]*/i);
        const testsMatch = body.match(/Tests?\s*[:：][^\n]*/i);

        // On retire les sections du body pour éviter les doublons
        let bodySansSections = body
          .replace(/Sympt[oô]mes?\s*[:：][^\n]*/i, "")
          .replace(/Cause\s*[:：][^\n]*/i, "")
          .replace(/Traitement\s*[:：][^\n]*/i, "")
          .replace(/Tests?\s*[:：][^\n]*/i, "");

        formatted += `🔹 ${idx + 1}. ${title.trim()}\n`;
        if (symptomesMatch) formatted += symptomesMatch[0].trim() + "\n";
        if (causeMatch) formatted += causeMatch[0].trim() + "\n";
        if (traitementMatch) formatted += traitementMatch[0].trim() + "\n";
        if (testsMatch) formatted += testsMatch[0].trim() + "\n";
        if (bodySansSections.trim())
          formatted += bodySansSections.trim() + "\n";
        formatted += "\n";
      });
      return formatted.trim();
    }

    const formattedResponse = formatAndOrderAIResponse(aiResponse);

    // Save to database
    const medicalAnalysis = new MedicalAnalysis({
      userId: userId,
      requestData: {
        age: parseInt(age),
        sexe: sexe,
        taille: parseInt(taille),
        poids: parseFloat(poids),
        symptomes: symptomes,
        niveauDouleur: parseInt(niveauDouleur),
        localisationDouleur: localisationDouleur,
      },
      responseData: {
        response: formattedResponse,
        usage: completion.usage,
      },
    });

    await medicalAnalysis.save();

    res.status(200).json({
      success: true,
      data: {
        response: formattedResponse,
        usage: completion.usage,
        analysisId: medicalAnalysis._id,
      },
    });
  } catch (error) {
    console.error("Error generating medical analysis:", error);
    res.status(500).json({
      success: false,
      message: "Error generating medical analysis",
    });
  }
};
