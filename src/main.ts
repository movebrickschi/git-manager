import { createApp } from "vue";
import { createPinia } from "pinia";
import { createRouter, createWebHashHistory } from "vue-router";
import App from "./App.vue";
import { i18n } from "./i18n";
import "./styles/main.css";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: "/",
      name: "welcome",
      component: () => import("./views/WelcomeView.vue"),
    },
    {
      path: "/repo",
      name: "repo",
      component: () => import("./views/GitLogView.vue"),
    },
  ],
});

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(i18n);
app.mount("#app");
