import busHeroImage from "@/Image/bukidnon-coach-hero.png";
import "./Bus3DHero.css";

export function Bus3DHero() {
  return (
    <div className="bus3d" aria-label="Bukidnon Bus Company coach">
      <div className="bus3d__image-mount">
        <img src={busHeroImage} alt="Bukidnon Bus Company coach" className="bus3d__image" />
      </div>
    </div>
  );
}
