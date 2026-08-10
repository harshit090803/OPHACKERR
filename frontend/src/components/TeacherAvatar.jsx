import { motion } from "framer-motion";

/**
 * Animated illustrated teacher avatar.
 * - `mouthOpen`: 0..1 drives lip opening for lip-sync
 * - `speaking`: boolean, controls subtle body sway
 */
export default function TeacherAvatar({ mouthOpen = 0, speaking = false }) {
  const mouth = Math.max(0, Math.min(1, mouthOpen));
  const mouthH = 3 + mouth * 22;
  return (
    <motion.svg
      viewBox="0 0 220 260"
      className="w-full h-full"
      animate={speaking ? { y: [0, -2, 0], rotate: [-0.6, 0.6, -0.6] } : { y: 0, rotate: 0 }}
      transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      data-testid="teacher-avatar"
    >
      {/* Chalkboard tie */}
      <rect x="98" y="200" width="24" height="60" fill="#171717" />
      <polygon points="110,200 96,210 110,220 124,210" fill="#7C3AED" stroke="#171717" strokeWidth="2.4" />
      <rect x="103" y="220" width="14" height="40" fill="#7C3AED" stroke="#171717" strokeWidth="2.4" />

      {/* Shoulders / shirt */}
      <path d="M40 260 Q40 205 110 200 Q180 205 180 260 Z" fill="#FDE047" stroke="#171717" strokeWidth="2.4" />

      {/* Neck */}
      <rect x="98" y="180" width="24" height="24" fill="#F5C99B" stroke="#171717" strokeWidth="2.4" />

      {/* Head */}
      <ellipse cx="110" cy="120" rx="62" ry="72" fill="#F5C99B" stroke="#171717" strokeWidth="2.6" />

      {/* Hair */}
      <path d="M50 100 Q52 40 110 40 Q168 40 170 100 Q160 78 130 78 Q120 55 110 78 Q90 55 90 82 Q68 78 50 100 Z" fill="#3F2A1D" stroke="#171717" strokeWidth="2.4" />

      {/* Ears */}
      <ellipse cx="48" cy="130" rx="8" ry="12" fill="#F5C99B" stroke="#171717" strokeWidth="2.2" />
      <ellipse cx="172" cy="130" rx="8" ry="12" fill="#F5C99B" stroke="#171717" strokeWidth="2.2" />

      {/* Glasses */}
      <circle cx="85" cy="122" r="16" fill="#FFFFFF" stroke="#171717" strokeWidth="2.6" />
      <circle cx="135" cy="122" r="16" fill="#FFFFFF" stroke="#171717" strokeWidth="2.6" />
      <line x1="101" y1="122" x2="119" y2="122" stroke="#171717" strokeWidth="2.6" />

      {/* Eyes with blink */}
      <motion.g
        animate={{ scaleY: [1, 1, 0.05, 1, 1] }}
        transition={{ duration: 4.5, repeat: Infinity, times: [0, 0.9, 0.94, 0.98, 1] }}
        style={{ transformOrigin: "85px 122px" }}
      >
        <circle cx="85" cy="122" r="4" fill="#171717" />
      </motion.g>
      <motion.g
        animate={{ scaleY: [1, 1, 0.05, 1, 1] }}
        transition={{ duration: 4.5, repeat: Infinity, times: [0, 0.9, 0.94, 0.98, 1] }}
        style={{ transformOrigin: "135px 122px" }}
      >
        <circle cx="135" cy="122" r="4" fill="#171717" />
      </motion.g>

      {/* Eyebrows */}
      <path d="M70 102 Q85 96 100 102" stroke="#171717" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M120 102 Q135 96 150 102" stroke="#171717" strokeWidth="3" fill="none" strokeLinecap="round" />

      {/* Nose */}
      <path d="M110 128 Q106 148 112 156 Q118 158 116 152" stroke="#171717" strokeWidth="2.4" fill="none" strokeLinecap="round" />

      {/* Cheeks */}
      <circle cx="70" cy="152" r="8" fill="#FBCFE8" opacity="0.7" />
      <circle cx="150" cy="152" r="8" fill="#FBCFE8" opacity="0.7" />

      {/* Mouth (animated) */}
      <rect
        x={110 - (12 + mouth * 8)}
        y={172 - mouthH / 2}
        width={24 + mouth * 16}
        height={mouthH}
        rx={Math.min(12, mouthH / 2)}
        fill="#7C1F1F"
        stroke="#171717"
        strokeWidth="2.4"
      />
      {/* Teeth line when mouth open */}
      {mouth > 0.35 && (
        <rect x={110 - (10 + mouth * 6)} y={172 - mouthH / 2 + 2} width={20 + mouth * 12} height={3} fill="#FFFFFF" />
      )}
    </motion.svg>
  );
}
