export const USER_ROLES = ["coordination", "teacher", "student"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type MemberRole = Exclude<UserRole, "coordination">;
export type AttendanceStatus = "present" | "absent" | "justified";
export type AttendanceMethod = "qr" | "manual";

export interface UserProfile {
  uid: string;
  schoolId: string;
  displayName: string;
  email: string;
  role: UserRole;
  /** Legacy aid for profiles created before the class_memberships collection. */
  classIds?: string[];
  teachingAssignments?: Array<{ classId: string; subjects: string[] }>;
  registration?: string;
  guardian?: { name: string; email?: string; phone?: string };
}

export interface RoomLocation {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface ClassScheduleEntry {
  weekday: number;
  startsAt: string;
  endsAt: string;
  subject: string;
  teacherId?: string;
}

export interface SchoolClass {
  id: string;
  schoolId: string;
  name: string;
  shift: string;
  subjects: string[];
  location?: RoomLocation;
  schedule?: ClassScheduleEntry[];
  studentCount?: number;
  teacherIds?: string[];
  studentIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ClassMembership {
  id: string;
  classId: string;
  schoolId: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
}

export interface Lesson {
  id: string;
  schoolId: string;
  classId: string;
  subject: string;
  teacherId: string;
  mode: "in-person" | "remote";
  status: "active" | "closed";
  startsAt: string;
  endsAt?: string;
  qrExpiresAt?: string;
  presentCount: number;
}

export interface AttendanceRecord {
  id: string;
  schoolId: string;
  lessonId: string;
  classId: string;
  studentId: string;
  status: AttendanceStatus;
  method: AttendanceMethod;
  markedBy: string;
  recordedAt: string;
  updatedAt?: string;
  location?: { verified: boolean; distanceMeters: number; accuracyMeters: number };
  note?: string;
}

export interface RosterEntry {
  uid: string;
  displayName: string;
  registration?: string;
  email?: string;
  attendance?: AttendanceRecord;
  attendanceRate: number;
  absenceCount: number;
}

export interface ClassOverview {
  schoolClass: SchoolClass;
  roster: RosterEntry[];
  activeLesson: Lesson | null;
  lessons: Lesson[];
  attendanceRate: number;
  presentToday: number;
  absentToday: number;
}

export interface DashboardClassSummary extends SchoolClass {
  studentCount: number;
  attendanceRate: number;
  activeLesson: Lesson | null;
}

export interface StaffDashboardSummary {
  classCount: number;
  studentCount: number;
  teacherCount: number;
  activeLessons: number;
  attendanceRate: number;
  present: number;
  absent: number;
  classes: DashboardClassSummary[];
}

export interface StudentDashboardSummary {
  present: number;
  absent: number;
  attendanceRate: number;
}

export interface ApiError { error: string; }
