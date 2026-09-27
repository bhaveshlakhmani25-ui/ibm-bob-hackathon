import { useRef, useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const FoldText = ({
  text = "",
  splitBy = "line",
  hinge = "top",
  trigger = "scroll",
  duration = 0.65,
  stagger = 0.045,
  ease = "power3.out",
  perspective = 700,
  creaseShading = 0.55,
  fontWeight = 800,
  color = "var(--text-primary)",
}) => {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Check for reduced motion
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      const words = containerRef.current.querySelectorAll(".fold-word");

      const tl = gsap.timeline({
        scrollTrigger: trigger === "scroll" ? {
          trigger: containerRef.current,
          start: "top 80%",
        } : undefined
      });

      // Simple implementation: fade in and translate Y (or rotateX if hinge is top)
      gsap.set(words, {
        transformPerspective: perspective,
        transformOrigin: hinge === "top" ? "50% 0%" : "50% 100%",
        rotationX: hinge === "top" ? -90 : 90,
        opacity: 0
      });

      tl.to(words, {
        rotationX: 0,
        opacity: 1,
        duration: duration,
        stagger: stagger,
        ease: ease,
      });

      if (creaseShading > 0) {
        // Optional crease shading effect could be added here
      }
    }, containerRef);

    return () => ctx.revert();
  }, [trigger, duration, stagger, ease, perspective, hinge, creaseShading]);

  // Split text by word for basic implementation if line is requested we'll just use word wrapping naturally
  const words = text.split(" ");

  return (
    <h1
      ref={containerRef}
      style={{
        fontWeight,
        color,
        display: "flex",
        flexWrap: "wrap",
        gap: "0.2em",
        margin: 0,
        lineHeight: 1.1,
      }}
      className="hero-headline"
    >
      {words.map((word, i) => (
        <span key={i} className="fold-word" style={{ display: "inline-block" }}>
          {word}
        </span>
      ))}
    </h1>
  );
};

export default FoldText;
