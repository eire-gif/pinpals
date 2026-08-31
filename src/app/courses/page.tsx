import Image from "next/image";
import CourseDirectory from "./course-directory";

export default function CoursesPage() {
  return (
    <div>
      <div className="relative bg-navy-900 text-white pt-16 pb-14 overflow-hidden">
        <Image
          src="/images/courses-header.jpg"
          alt="Aerial view of an Irish links golf course"
          fill
          className="object-cover -z-10 opacity-40"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[rgba(9,22,40,0.55)] to-[rgba(9,22,40,0.92)] -z-10" />
        <div className="max-w-6xl mx-auto px-6">
          <span className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-gold-500">
            <span className="w-5 h-0.5 bg-gold-500 inline-block" /> Course directory
          </span>
          <h1 className="font-display font-bold text-4xl mt-2.5">All 373 clubs, A to Z.</h1>
          <p className="text-white/80 mt-3 max-w-[52ch]">
            Every course on Pinpals, ready to set as your home club when you sign up.
          </p>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-6 py-14">
        <CourseDirectory />
      </div>
    </div>
  );
}
