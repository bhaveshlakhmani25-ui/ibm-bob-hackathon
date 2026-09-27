import React, { useState, useEffect, useRef } from 'react';

const TextType = ({
  text,
  as: Component = 'div',
  typingSpeed = 45,
  initialDelay = 150,
  pauseDuration = 1000,
  deletingSpeed = 30,
  loop = false,
  showCursor = true,
  hideCursorWhileTyping = false,
  cursorCharacter = '|',
  startOnVisible = true,
  className = '',
  ...props
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasStarted, setHasStarted] = useState(!startOnVisible);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!startOnVisible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [startOnVisible]);

  useEffect(() => {
    if (!hasStarted) return;

    let timeout;
    let currentIndex = 0;

    const typeText = () => {
      setIsTyping(true);
      if (currentIndex < text.length) {
        setDisplayedText(text.substring(0, currentIndex + 1));
        currentIndex++;
        timeout = setTimeout(typeText, typingSpeed);
      } else {
        setIsTyping(false);
        if (loop) {
          timeout = setTimeout(deleteText, pauseDuration);
        }
      }
    };

    const deleteText = () => {
      setIsTyping(true);
      if (currentIndex > 0) {
        setDisplayedText(text.substring(0, currentIndex - 1));
        currentIndex--;
        timeout = setTimeout(deleteText, deletingSpeed);
      } else {
        setIsTyping(false);
        timeout = setTimeout(typeText, initialDelay);
      }
    };

    timeout = setTimeout(typeText, initialDelay);

    return () => clearTimeout(timeout);
  }, [hasStarted, text, typingSpeed, initialDelay, pauseDuration, deletingSpeed, loop]);

  const showBlinkCursor = showCursor && (!hideCursorWhileTyping || !isTyping);

  return (
    <Component ref={containerRef} className={className} {...props}>
      {displayedText}
      {showCursor && (
        <span
          style={{
            opacity: showBlinkCursor ? 1 : 0,
            animation: showBlinkCursor && !isTyping ? 'blink 1s step-end infinite' : 'none',
            display: 'inline-block',
            fontWeight: '300',
            marginLeft: '4px',
            color: 'var(--text-secondary)',
            WebkitTextFillColor: 'initial'
          }}
        >
          {cursorCharacter}
        </span>
      )}
    </Component>
  );
};

export default TextType;
