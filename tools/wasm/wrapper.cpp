#include <emscripten.h>
#include <emscripten/html5.h>
#include <projectM-4/projectM.h>
#include <projectM-4/parameters.h>
#include <projectM-4/render_opengl.h>
#include <cstdio>
#include <cstring>
#include <string>

extern "C" {

static projectm_handle instance = nullptr;
static EMSCRIPTEN_WEBGL_CONTEXT_HANDLE context = 0;
static char version_buffer[64] = {0};

EMSCRIPTEN_KEEPALIVE int mdw_init(const char *canvas_selector, int width, int height)
{
    EmscriptenWebGLContextAttributes attributes;
    emscripten_webgl_init_context_attributes(&attributes);
    attributes.majorVersion = 2;
    attributes.minorVersion = 0;
    attributes.alpha = false;
    attributes.depth = false;
    attributes.stencil = false;
    attributes.antialias = false;
    attributes.preserveDrawingBuffer = false;

    context = emscripten_webgl_create_context(canvas_selector, &attributes);
    if (context <= 0) {
        return -1;
    }

    emscripten_webgl_make_context_current(context);
    emscripten_webgl_enable_extension(context, "OES_texture_float");
    emscripten_webgl_enable_extension(context, "EXT_color_buffer_float");

    instance = projectm_create();
    if (!instance) {
        return -2;
    }

    int major = 0, minor = 0, patch = 0;
    projectm_get_version_components(&major, &minor, &patch);
    snprintf(version_buffer, sizeof(version_buffer), "%d.%d.%d", major, minor, patch);

    projectm_set_window_size(instance, width, height);
    projectm_set_mesh_size(instance, 48, 36);
    projectm_set_fps(instance, 60);
    projectm_set_aspect_correction(instance, true);
    projectm_set_soft_cut_duration(instance, 2.5);
    projectm_set_hard_cut_enabled(instance, false);
    projectm_set_preset_locked(instance, true);
    projectm_set_beat_sensitivity(instance, 1.0);

    const char* texture_paths[1] = {"/textures"};
    projectm_set_texture_search_paths(instance, texture_paths, 1);

    return 0;
}

EMSCRIPTEN_KEEPALIVE void mdw_load_preset(const char *data, int smooth)
{
    if (instance && data) {
        projectm_load_preset_data(instance, data, smooth != 0);
    }
}

EMSCRIPTEN_KEEPALIVE void mdw_add_pcm(const float *samples, unsigned int count)
{
    if (instance && samples && count) {
        projectm_pcm_add_float(instance, samples, count, PROJECTM_MONO);
    }
}

EMSCRIPTEN_KEEPALIVE void mdw_render()
{
    if (instance && context > 0) {
        emscripten_webgl_make_context_current(context);
        projectm_opengl_render_frame(instance);
    }
}

EMSCRIPTEN_KEEPALIVE void mdw_resize(int width, int height)
{
    if (instance) {
        projectm_set_window_size(instance, width, height);
    }
}

EMSCRIPTEN_KEEPALIVE void mdw_set_soft_cut(double seconds)
{
    if (instance) {
        projectm_set_soft_cut_duration(instance, seconds);
    }
}

EMSCRIPTEN_KEEPALIVE void mdw_set_fps(int fps)
{
    if (instance) {
        projectm_set_fps(instance, fps);
    }
}

EMSCRIPTEN_KEEPALIVE void mdw_set_mesh(int width, int height)
{
    if (instance) {
        projectm_set_mesh_size(instance, width, height);
    }
}

EMSCRIPTEN_KEEPALIVE void mdw_set_aspect_correction(int enabled)
{
    if (instance) {
        projectm_set_aspect_correction(instance, enabled != 0);
    }
}

EMSCRIPTEN_KEEPALIVE void mdw_set_beat_sensitivity(double sensitivity)
{
    if (instance) {
        projectm_set_beat_sensitivity(instance, (float)sensitivity);
    }
}

EMSCRIPTEN_KEEPALIVE const char* mdw_version()
{
    return version_buffer;
}

EMSCRIPTEN_KEEPALIVE void mdw_destroy()
{
    if (instance) {
        projectm_destroy(instance);
        instance = nullptr;
    }
    if (context > 0) {
        emscripten_webgl_destroy_context(context);
        context = 0;
    }
}

} // extern "C"
