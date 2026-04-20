import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface UseThreeViewerOptions {
  heightField: number[][] | null;
  physicalSizeX?: number;
  physicalSizeY?: number;
}

export function useThreeViewer({ heightField, physicalSizeX = 0.05, physicalSizeY = 0.05 }: UseThreeViewerOptions) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── Renderer ────────────────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0xf8f8f6);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    // ── Scene / Camera ────────────────────────────────────────────────────
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.0001,
      100,
    );
    const diagSize = Math.sqrt(physicalSizeX * physicalSizeX + physicalSizeY * physicalSizeY);
    camera.position.set(physicalSizeX * 1.5, diagSize * 1.5, physicalSizeY * 2.5);
    camera.lookAt(physicalSizeX / 2, diagSize / 4, physicalSizeY / 2);

    // ── Lights ───────────────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(physicalSizeX * 2, diagSize * 3, physicalSizeY * 2);
    scene.add(dirLight);

    // ── Orbit controls ───────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = diagSize * 0.5;
    controls.maxDistance = diagSize * 20;
    controls.target.set(physicalSizeX / 2, 0, physicalSizeY / 2);

    // ── Height field mesh ─────────────────────────────────────────────────
    let mesh: THREE.Mesh | null = null;

    if (heightField && heightField.length > 0) {
      const ny = heightField.length;
      const nx = heightField[0].length;
      const dx = physicalSizeX / (nx - 1);
      const dy = physicalSizeY / (ny - 1);

      const geometry = new THREE.BufferGeometry();
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      // Build vertices
      for (let i = 0; i < ny; i++) {
        for (let j = 0; j < nx; j++) {
          const x = j * dx;
          const z = i * dy;
          const y = heightField[i][j];
          positions.push(x, y, z);
          uvs.push(j / (nx - 1), i / (ny - 1));
          normals.push(0, 1, 0); // placeholder, recomputed below
        }
      }

      // Build quad indices
      for (let i = 0; i < ny - 1; i++) {
        for (let j = 0; j < nx - 1; j++) {
          const i0 = i * nx + j;
          const i1 = i * nx + (j + 1);
          const i2 = (i + 1) * nx + j;
          const i3 = (i + 1) * nx + (j + 1);
          indices.push(i0, i1, i3);
          indices.push(i0, i3, i2);
        }
      }

      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: 0xe8e8e4,
        roughness: 0.15,
        metalness: 0.0,
        side: THREE.DoubleSide,
        wireframe: false,
      });

      mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);

      // Wireframe overlay (subtle)
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0xcccccc,
        wireframe: true,
        transparent: true,
        opacity: 0.12,
      });
      const wireMesh = new THREE.Mesh(geometry, wireMat);
      scene.add(wireMesh);
    } else {
      // Placeholder grid when no height field
      const grid = new THREE.GridHelper(Math.max(physicalSizeX, physicalSizeY), 10, 0xdddddd, 0xeeeeee);
      scene.add(grid);
    }

    // ── Resize handler ───────────────────────────────────────────────────
    const onResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", onResize);

    // ── Render loop ──────────────────────────────────────────────────────
    let raf: number;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      mesh?.geometry.dispose();
    };
  }, [heightField, physicalSizeX, physicalSizeY]);

  return containerRef;
}
