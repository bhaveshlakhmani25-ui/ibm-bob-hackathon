import { useEffect, useState, useRef } from 'react';
import { motion, useInView } from 'framer-motion';

const defaultChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';

export default function DecryptedText({
  text = '',
  speed = 40,
  maxIterations = 15,
  sequential = false,
  revealDirection = 'start',
  useOriginalCharsOnly = false,
  characters = defaultChars,
  className = '',
  animateOn = 'hover',
  ...props
}) {
  const [displayText, setDisplayText] = useState(text);
  const [isHovering, setIsHovering] = useState(false);
  const containerRef = useRef(null);
  const isInView = useInView(containerRef, { once: true, margin: '-10%' });
  const intervalRef = useRef(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    let shouldAnimate = false;
    if (animateOn === 'view' && isInView && !hasAnimated.current) {
      shouldAnimate = true;
      hasAnimated.current = true;
    } else if (animateOn === 'hover' && isHovering) {
      shouldAnimate = true;
    }

    if (shouldAnimate) {
      let iteration = 0;
      const chars = useOriginalCharsOnly ? text.split('').filter(c => c !== ' ') : characters.split('');
      const charArray = text.split('');

      clearInterval(intervalRef.current);

      intervalRef.current = setInterval(() => {
        setDisplayText(
          charArray.map((char, index) => {
            if (char === ' ') return ' ';

            let revealCondition = false;
            if (sequential) {
              if (revealDirection === 'start') {
                revealCondition = iteration >= index;
              } else if (revealDirection === 'end') {
                revealCondition = iteration >= (charArray.length - 1 - index);
              } else if (revealDirection === 'center') {
                const center = Math.floor(charArray.length / 2);
                const distance = Math.abs(center - index);
                revealCondition = iteration >= distance;
              }
            } else {
              revealCondition = iteration >= maxIterations;
            }

            if (revealCondition) {
              return char;
            }
            return chars[Math.floor(Math.random() * chars.length)];
          }).join('')
        );

        if (iteration >= (sequential ? charArray.length : maxIterations)) {
          clearInterval(intervalRef.current);
          setDisplayText(text); // ensure final state
        }

        iteration += 1;
      }, speed);
    } else if (animateOn === 'hover' && !isHovering && !hasAnimated.current) {
      clearInterval(intervalRef.current);
      setDisplayText(text);
    }

    return () => clearInterval(intervalRef.current);
  }, [isHovering, isInView, animateOn, text, speed, maxIterations, sequential, revealDirection, useOriginalCharsOnly, characters]);

  return (
    <motion.span
      ref={containerRef}
      className={className}
      onMouseEnter={() => animateOn === 'hover' && setIsHovering(true)}
      onMouseLeave={() => animateOn === 'hover' && setIsHovering(false)}
      {...props}
    >
      {displayText}
    </motion.span>
  );
}
