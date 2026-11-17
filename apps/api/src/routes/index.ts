import { Router } from "express";
import { requireUser } from "../middleware/auth";
import { attendanceRouter } from "./attendance";
import { classesRouter } from "./classes";
import { dashboardRouter } from "./dashboard";
import { lessonsRouter } from "./lessons";
import { protocolsRouter } from "./protocols";
import { usersRouter } from "./users";

export const router = Router();
router.get("/health", (_req, res) => res.json({ status: "ok", service: "educonnect-api" }));
router.use(requireUser);
router.get("/me", (req, res) => res.json({ user: req.user }));
router.use("/classes", classesRouter);
router.use("/lessons", lessonsRouter);
router.use("/attendance", attendanceRouter);
router.use("/dashboard", dashboardRouter);
router.use("/protocols", protocolsRouter);
router.use("/users", usersRouter);
